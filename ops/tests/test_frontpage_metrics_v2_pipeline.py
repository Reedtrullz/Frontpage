import threading
import io
import json
from unittest import mock
import unittest

from ops.frontpage_metrics_v2 import daemon


class PipelineTests(unittest.TestCase):
    def test_nonpositive_queue_capacity_is_rejected(self):
        for capacity in (0, -1):
            with self.subTest(capacity=capacity), self.assertRaises(ValueError):
                daemon.run_pipeline(lambda tick: tick, lambda row: False, threading.Event(), capacity=capacity)

    def test_real_acquisition_continues_while_publication_is_blocked(self):
        acquired = []
        consumed = []
        publishing = threading.Event()
        fourth = threading.Event()
        stop = threading.Event()

        def acquire(now_ms):
            acquired.append(now_ms)
            if len(acquired) == 4:
                fourth.set()
            return now_ms

        def consume(row):
            publishing.set()
            self.assertTrue(fourth.wait(2), "Publication blocked subsequent host acquisition")
            consumed.append(row)
            if len(consumed) == 4:
                stop.set()
            return False

        def aligned(callback, stop_event, *_args, **_kwargs):
            for tick in (15000, 30000, 45000, 60000):
                callback(tick)
                if tick == 15000:
                    self.assertTrue(publishing.wait(2))

        self.assertTrue(hasattr(daemon, "run_pipeline"), "Acquisition still shares the publication loop")
        daemon.run_pipeline(acquire, consume, stop, aligned=aligned)
        self.assertEqual(acquired, [15000, 30000, 45000, 60000])
        self.assertEqual(consumed, acquired)

    def test_consumer_failure_stops_acquisition_and_propagates(self):
        stop = threading.Event()
        def aligned(callback, stopped, *_args, **_kwargs):
            callback(15000)
            stopped.wait(2)
        def failed(_row):
            raise ValueError("publication failed")
        self.assertTrue(hasattr(daemon, "run_pipeline"))
        with self.assertRaisesRegex(ValueError, "publication failed"):
            daemon.run_pipeline(lambda tick: tick, failed, stop, aligned=aligned)
        self.assertTrue(stop.is_set())

    def test_queue_overflow_reports_genuine_lost_slot(self):
        stop = threading.Event()
        consuming, filled = threading.Event(), threading.Event()
        consumed = []
        def aligned(callback, *_args, **_kwargs):
            callback(15000)
            self.assertTrue(consuming.wait(2))
            for tick in (30000, 45000, 60000, 75000, 90000):
                callback(tick)
            filled.set()
        def consume(row):
            consuming.set()
            self.assertTrue(filled.wait(2))
            consumed.append(row)
            return False
        output = io.StringIO()
        with mock.patch("sys.stderr", output):
            daemon.run_pipeline(lambda tick: tick, consume, stop, aligned=aligned)
        self.assertEqual(consumed, [15000, 30000, 45000, 60000, 75000])
        self.assertEqual(json.loads(output.getvalue()), {
            "event": "frontpage_metrics_acquisition_skipped", "ts_ms": 90000, "reason": "queue_full"})

    def test_acquisition_failure_reaches_consumer_owner(self):
        stop = threading.Event()
        def failed(_tick): raise ValueError("host read failed")
        def aligned(callback, *_args, **_kwargs): callback(15000)
        with self.assertRaisesRegex(ValueError, "host read failed"):
            daemon.run_pipeline(failed, lambda row: False, stop, aligned=aligned)
        self.assertTrue(stop.is_set())

    def test_database_backpressure_skips_next_actual_slot(self):
        stop = threading.Event()
        consumed = []
        ready = threading.Event()
        # Signal after the main consumer has set the backpressure flag by
        # observing its next queue read, rather than depending on thread timing.
        original_get = daemon.queue.Queue.get
        def get(pending, *args, **kwargs):
            if consumed: ready.set()
            return original_get(pending, *args, **kwargs)
        def aligned(callback, *_args, **_kwargs):
            callback(15000)
            self.assertTrue(ready.wait(2))
            callback(30000)
            callback(45000)
        def consume(row):
            consumed.append(row)
            return row == 15000
        output = io.StringIO()
        with mock.patch.object(daemon.queue.Queue, "get", get), mock.patch("sys.stderr", output):
            daemon.run_pipeline(lambda tick: tick, consume, stop, aligned=aligned)
        self.assertEqual(consumed, [15000, 45000])
        self.assertEqual(json.loads(output.getvalue())["reason"], "database_backpressure")

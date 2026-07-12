import unittest

from ops.frontpage_metrics_v2.rollups import (
    RollupBucket,
    bucket_start_ms,
    rollup_counter,
    rollup_gauge,
    rollup_service,
)


class RollupTests(unittest.TestCase):
    def test_counter_rollup_sums_positive_deltas_and_tracks_resets(self):
        result = rollup_counter([100, 140, 20, 50], expected_samples=4, interval_seconds=15)
        self.assertEqual(result.sum_delta, 70)
        self.assertEqual(result.reset_count, 1)
        self.assertEqual(result.coverage_percent, 100.0)
        self.assertAlmostEqual(result.maximum_rate, 40 / 15)

    def test_gauge_rollup_keeps_peak_and_missing_coverage(self):
        result = rollup_gauge([10.0, 95.0, 20.0], expected_samples=4)
        self.assertEqual(result.minimum, 10.0)
        self.assertEqual(result.maximum, 95.0)
        self.assertEqual(result.last, 20.0)
        self.assertEqual(result.coverage_percent, 75.0)

    def test_counter_gaps_do_not_create_rates_across_missing_time(self):
        result = rollup_counter([100, None, 160], expected_samples=3, interval_seconds=15)
        self.assertEqual(result.sum_delta, 0)
        self.assertIsNone(result.maximum_rate)
        self.assertEqual(result.coverage_percent, 200 / 3)

    def test_service_rollup_keeps_unknown_out_of_availability_denominator(self):
        result = rollup_service(["up", "down", "unknown", "up"], expected_samples=4)
        self.assertEqual(result.up_count, 2)
        self.assertEqual(result.down_count, 1)
        self.assertAlmostEqual(result.availability_percent, 200 / 3)
        self.assertEqual(result.coverage_percent, 75.0)
        self.assertEqual(result.transitions, 1)

    def test_bucket_boundaries_are_epoch_aligned(self):
        self.assertEqual(bucket_start_ms(125_999, 60), 120_000)
        self.assertEqual(bucket_start_ms(900_000, 900), 900_000)

    def test_service_record_interface_groups_by_service_id(self):
        result = rollup_service(
            [
                {"service_id": "frontpage", "status": "up"},
                {"service_id": "frontpage", "status": "down"},
            ],
            RollupBucket(expected_samples=4, interval_seconds=15),
        )
        self.assertEqual(result["frontpage"].coverage_percent, 50.0)


if __name__ == "__main__":
    unittest.main()

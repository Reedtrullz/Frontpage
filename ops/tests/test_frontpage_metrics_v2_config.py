import copy
import dataclasses
import json
import tempfile
import unittest
from pathlib import Path

from ops.frontpage_metrics_v2.config import load_config, load_payload
from ops.frontpage_metrics_v2.model import ProcessSample, SourceResult


def valid_config():
    return {
        "schema_version": 2,
        "sample_interval_seconds": 15,
        "retention": {
            "raw_seconds": 3600,
            "minute_seconds": 604800,
            "quarter_hour_seconds": 2592000,
            "incident_seconds": 7776000,
        },
        "paths": {
            "public_dir": "/var/lib/frontpage-metrics/v2/public",
            "owner_dir": "/var/lib/frontpage-metrics/v2/owner",
            "database_path": "/var/lib/frontpage-metrics/private/metrics-v2.sqlite3",
            "runtime_map_path": "/run/frontpage-metrics/runtime-map.json",
            "root_filesystems": ["/"],
            "block_devices": ["vda"],
            "network_interfaces": ["eth0"],
        },
        "network_attribution": {
            "mode": "host-only",
            "capability": "unavailable",
        },
        "thresholds": {
            "disk_warning_percent": 80,
            "disk_critical_percent": 90,
            "service_failures": 2,
            "service_recoveries": 2,
            "reconciliation_error_percent": 10,
        },
        "workloads": [
            {
                "id": "frontpage-app",
                "label": "Frontpage app",
                "project_slug": "frontpage",
                "match": {
                    "type": "cgroup-pattern",
                    "value": "^system\\.slice/docker-[a-f0-9]{64}\\.scope$",
                },
            }
        ],
        "services": [
            {
                "id": "frontpage-public",
                "label": "Frontpage",
                "project_slug": "frontpage",
                "visibility": "public",
                "url": "http://127.0.0.1:3002/api/health",
                "expected_status": 200,
                "check": {
                    "type": "json-field",
                    "path": ["status"],
                    "expected": "healthy",
                },
                "timeout_ms": 5000,
            }
        ],
    }


class CollectorV2ConfigTests(unittest.TestCase):
    def test_valid_config_is_frozen_and_uses_exact_retention(self):
        config = load_payload(valid_config())

        self.assertEqual(config.sample_interval_seconds, 15)
        self.assertEqual(config.raw_retention_seconds, 3600)
        self.assertEqual(config.minute_retention_seconds, 7 * 86400)
        self.assertEqual(config.quarter_hour_retention_seconds, 30 * 86400)
        self.assertEqual(config.incident_retention_seconds, 90 * 86400)
        self.assertEqual(config.workloads[0].match_type, "cgroup-pattern")
        with self.assertRaises(dataclasses.FrozenInstanceError):
            config.sample_interval_seconds = 30

    def test_rejects_duplicate_ids_across_each_inventory(self):
        for key in ("workloads", "services"):
            with self.subTest(key=key):
                payload = valid_config()
                payload[key].append(copy.deepcopy(payload[key][0]))
                with self.assertRaisesRegex(ValueError, "Duplicate"):
                    load_payload(payload)

    def test_rejects_more_than_32_workloads(self):
        payload = valid_config()
        template = payload["workloads"][0]
        payload["workloads"] = [
            {**copy.deepcopy(template), "id": f"workload-{index}"}
            for index in range(33)
        ]
        with self.assertRaisesRegex(ValueError, "32"):
            load_payload(payload)

    def test_rejects_unanchored_cgroup_pattern(self):
        payload = valid_config()
        payload["workloads"][0]["match"] = {
            "type": "cgroup-pattern",
            "value": "docker-.*",
        }
        with self.assertRaisesRegex(ValueError, "anchored"):
            load_payload(payload)

    def test_rejects_cgroup_pattern_longer_than_160_characters(self):
        payload = valid_config()
        payload["workloads"][0]["match"] = {
            "type": "cgroup-pattern",
            "value": "^" + "a" * 159 + "$",
        }
        with self.assertRaisesRegex(ValueError, "160"):
            load_payload(payload)

    def test_rejects_secret_or_redirectable_service_url_shapes(self):
        invalid_urls = (
            "https://user:secret@example.com/health",
            "file:///etc/passwd",
            "https://example.com/health?token=secret",
            "https://example.com/health#private",
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                payload = valid_config()
                payload["services"][0]["url"] = url
                with self.assertRaisesRegex(ValueError, "URL"):
                    load_payload(payload)

    def test_rejects_invalid_retention_or_sample_values(self):
        mutations = (
            ("sample_interval_seconds", None, 30),
            ("retention", "raw_seconds", 3599),
            ("retention", "minute_seconds", 604799),
            ("retention", "quarter_hour_seconds", 2591999),
            ("retention", "incident_seconds", 7775999),
        )
        for section, key, value in mutations:
            with self.subTest(section=section, key=key):
                payload = valid_config()
                if key is None:
                    payload[section] = value
                else:
                    payload[section][key] = value
                with self.assertRaisesRegex(ValueError, "exactly"):
                    load_payload(payload)

    def test_rejects_workload_network_mode_without_capability(self):
        payload = valid_config()
        payload["network_attribution"] = {
            "mode": "workload",
            "capability": "unavailable",
        }
        with self.assertRaisesRegex(ValueError, "capability"):
            load_payload(payload)

    def test_rejects_unknown_keys_and_invalid_service_checks(self):
        payload = valid_config()
        payload["secret"] = "not allowed"
        with self.assertRaisesRegex(ValueError, "Unknown"):
            load_payload(payload)

        payload = valid_config()
        payload["services"][0]["check"]["path"] = ["a", "b", "c", "d"]
        with self.assertRaisesRegex(ValueError, "path"):
            load_payload(payload)

    def test_load_config_reads_a_json_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(valid_config()), encoding="utf-8")
            config = load_config(path)
        self.assertEqual(config.public_dir, Path("/var/lib/frontpage-metrics/v2/public"))

    def test_internal_models_are_frozen_and_source_results_are_explicit(self):
        process = ProcessSample(
            pid=42,
            comm="node",
            uid=1000,
            cpu_percent=12.5,
            rss_bytes=4096,
            state="running",
            workload_id="frontpage-app",
        )
        result = SourceResult(
            value=(process,),
            available=True,
            capabilities={"process_visibility": "available"},
            errors=(),
        )
        self.assertEqual(result.value[0].workload_id, "frontpage-app")
        with self.assertRaises(dataclasses.FrozenInstanceError):
            process.pid = 43


class ProductionCollectorV2ConfigTests(unittest.TestCase):
    def test_checked_in_config_declares_exact_service_inventory(self):
        path = Path(__file__).parents[1] / "frontpage-metrics-v2.config.json"
        config = load_config(path)
        self.assertEqual(
            {service["id"] for service in config.services},
            {
                "frontpage-public",
                "frontpage-internal",
                "nytt-public",
                "rfs-public",
                "rfmc-public",
                "heimdall-public",
            },
        )
        self.assertEqual(config.root_filesystems, (Path("/"),))
        self.assertGreaterEqual(len(config.block_devices), 1)
        self.assertGreaterEqual(len(config.network_interfaces), 1)
        self.assertEqual(config.network_attribution_mode, "host-only")


if __name__ == "__main__":
    unittest.main()

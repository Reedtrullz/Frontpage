import json
import grp
import os
import pwd
import subprocess
import tempfile
import threading
import textwrap
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


ROOT = Path(__file__).parents[1].parent
PLAYBOOK = ROOT / "ansible-playbook.yml"
PREFLIGHT = ROOT / "ops" / "ansible" / "container-preflight.yml"
SWAP = ROOT / "ops" / "ansible" / "container-swap.yml"
TEST_USER = pwd.getpwuid(os.getuid()).pw_name
TEST_GROUP = grp.getgrgid(os.getgid()).gr_name


DOCKER_MODULE = r'''
from ansible.module_utils.basic import AnsibleModule
import json
import os

state_path = os.environ["MOCK_DOCKER_STATE"]
failure = os.environ.get("MOCK_DOCKER_FAILURE", "")
with open(state_path, encoding="utf-8") as handle:
    state_data = json.load(handle)
module = AnsibleModule(argument_spec={
    "name": {"type": "str", "required": True},
    "image": {"type": "str"},
    "state": {"type": "str"},
    "env": {"type": "raw"},
    "volumes": {"type": "raw"},
    "groups": {"type": "raw"},
    "healthcheck": {"type": "raw"},
    "log_driver": {"type": "str"},
    "log_options": {"type": "raw"},
    "ports": {"type": "raw"},
    "restart_policy": {"type": "str"},
}, supports_check_mode=True)
name = module.params["name"]
image = module.params.get("image")
requested_state = module.params.get("state")
if requested_state == "absent":
    state_data["image"] = None
    state_data["events"].append("stop")
elif requested_state == "started":
    if failure == "start" and image == "new-image":
        module.fail_json(msg="mock start failure")
    if failure == "rollback" and image == "previous-image":
        module.fail_json(msg="mock rollback failure")
    state_data["image"] = image
    state_data["version"] = (module.params.get("env") or {}).get("VERSION")
    if failure == "health-wrong-rollback-version" and image == "previous-image":
        state_data["version"] = "c" * 40
    if failure == "health-wrong-new-version" and image == "new-image":
        state_data["version"] = "c" * 40
    state_data["events"].append("start:" + str(image))
with open(state_path, "w", encoding="utf-8") as handle:
    json.dump(state_data, handle)
module.exit_json(changed=True, name=name)
'''


DOCKER_INFO_MODULE = r'''
from ansible.module_utils.basic import AnsibleModule
import json
import os

module = AnsibleModule(argument_spec={"name": {"type": "str", "required": True}})
with open(os.environ["MOCK_DOCKER_STATE"], encoding="utf-8") as handle:
    state_data = json.load(handle)
image = state_data.get("image")
if image is None:
    module.exit_json(changed=False, exists=False, container={})
module.exit_json(
    changed=False,
    exists=True,
    container={
        "Image": image,
        "State": {"Pid": 1234, "Status": "running"},
        "Config": {"Image": image, "Env": ["VERSION=previous"]},
    },
)
'''


IMAGE_INFO_MODULE = r'''
from ansible.module_utils.basic import AnsibleModule

module = AnsibleModule(argument_spec={"name": {"type": "str", "required": True}})
module.exit_json(changed=False, images=[{"RepoTags": [module.params["name"]]}])
'''


class _HealthHandler(BaseHTTPRequestHandler):
    state_path: str
    failure: str

    def do_GET(self):  # noqa: N802
        with open(self.state_path, encoding="utf-8") as handle:
            image = json.load(handle).get("image")
        unhealthy = self.failure in {"health", "rollback", "health-wrong-rollback-version"} and image == "new-image"
        unhealthy = unhealthy or (
            self.failure == "health-rollback" and image in {"new-image", "previous-image"}
        )
        status = 503 if unhealthy else 200
        with open(self.state_path, encoding="utf-8") as handle:
            version = json.load(handle).get("version", "")
        payload = (
            json.dumps({"status": "unhealthy" if unhealthy else "healthy", "version": version})
            .encode("utf-8")
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


def write_executable(path: Path, content: str) -> None:
    path.write_text(content)
    path.chmod(0o755)


def run_ansible(playbook: Path, variables: dict[str, object], environment: dict[str, str], temp: Path):
    inventory = temp / "inventory"
    inventory.write_text("localhost ansible_connection=local\n")
    runner = temp / "runner.yml"
    runner.write_text(
        "- hosts: localhost\n"
        "  gather_facts: false\n"
        "  tasks:\n"
        f"    - ansible.builtin.include_tasks: {playbook}\n"
    )
    command = [
        "ansible-playbook",
        "-i",
        str(inventory),
        str(runner),
        "-e",
        json.dumps(variables),
    ]
    return subprocess.run(
        command,
        cwd=ROOT,
        env={**os.environ, **environment},
        text=True,
        capture_output=True,
        timeout=30,
    )


class FrontpageDeploySafetyTests(unittest.TestCase):
    def test_shadow_maintenance_preserves_installed_upload_transport(self):
        source = (ROOT / "ansible-cloudflare-collector.yml").read_text()
        start = source.index("    - name: Install uploader")
        end = source.index("    - name: Install collector upload secret", start)
        for maintenance in (True, False):
            with self.subTest(maintenance=maintenance), tempfile.TemporaryDirectory() as directory:
                temp = Path(directory)
                destination = temp / "installed-upload"
                destination.write_text("compatible legacy transport")
                fragment = temp / "install.yml"
                task = textwrap.dedent(source[start:end])
                task = task.replace("src: ops/frontpage-metrics-upload.py", "content: reviewed transport")
                task = task.replace("dest: /usr/local/bin/frontpage-metrics-upload", f"dest: {destination}")
                task = task.replace("owner: root", f"owner: {TEST_USER}").replace("group: root", f"group: {TEST_GROUP}")
                fragment.write_text(task)
                result = run_ansible(fragment, {"maintain_collectors": maintenance}, {}, temp)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(destination.read_text(), "compatible legacy transport" if maintenance else "reviewed transport")

    def test_actual_shadow_maintenance_guard_and_missing_epoch_recovery(self):
        source = (ROOT / "ansible-cloudflare-collector.yml").read_text()
        names = (
            "Inspect promoted collector before shadow maintenance",
            "Refuse shadow maintenance of an already promoted collector",
            "Inspect the required shadow evidence marker",
            "Recover missing evidence markers on unchanged maintenance",
        )
        for active, marker_exists in ((True, True), (False, True), (False, False)):
            with self.subTest(active=active, marker_exists=marker_exists), tempfile.TemporaryDirectory() as directory:
                temp = Path(directory)
                marker = temp / "epoch.json"
                if marker_exists:
                    marker.write_text("{}")
                tasks = []
                for name in names:
                    start = source.index("    - name: " + name)
                    end = source.find("    - name: ", start + 1)
                    tasks.append(textwrap.dedent(source[start:end if end >= 0 else len(source)]))
                fragment = temp / "maintenance.yml"
                fragment.write_text("\n".join(tasks).replace("/var/lib/frontpage-metrics/shadow-evidence-epoch.json", str(marker)) +
                                    "\n- ansible.builtin.assert:\n    that:\n      - evidence_reset_required == expected_reset\n")
                bin_dir = temp / "bin"
                bin_dir.mkdir()
                write_executable(bin_dir / "systemctl", """#!/usr/bin/env python3
import os, sys
if sys.argv[1] == 'is-enabled':
    print('disabled')
    sys.exit(1)
active = os.environ['MOCK_PROMOTED_ACTIVE'] == '1'
print('active' if active else 'inactive')
sys.exit(0 if active else 3)
""")
                result = run_ansible(fragment, {
                    "maintain_collectors": True, "mark_primary": False,
                    "comparison_changed": False, "expected_reset": not marker_exists,
                }, {"PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
                    "MOCK_PROMOTED_ACTIVE": "1" if active else "0"}, temp)
                if active:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("Shadow maintenance cannot restart a second writer", result.stdout)
                else:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _write_mock_collection(self, temp: Path) -> Path:
        collection_root = temp / "collections"
        module_root = collection_root / "ansible_collections" / "community" / "docker" / "plugins" / "modules"
        module_root.mkdir(parents=True)
        (module_root / "docker_container.py").write_text(DOCKER_MODULE)
        (module_root / "docker_container_info.py").write_text(DOCKER_INFO_MODULE)
        (module_root / "docker_image_info.py").write_text(IMAGE_INFO_MODULE)
        return collection_root

    def _swap_run(self, failure: str):
        temp_context = tempfile.TemporaryDirectory()
        temp = Path(temp_context.name)
        state_path = temp / "docker-state.json"
        state_path.write_text(json.dumps({"image": "previous-image", "version": "b" * 40, "events": []}))
        collection_root = self._write_mock_collection(temp)
        runtime_map = temp / "runtime-map.py"
        write_executable(
            runtime_map,
            """#!/usr/bin/env python3
import json, os, pathlib, sys
with open(os.environ['MOCK_DOCKER_STATE'], encoding='utf-8') as handle:
    image = json.load(handle).get('image')
if os.environ.get('MOCK_DOCKER_FAILURE') == 'runtime-map' and image == 'new-image':
    raise SystemExit(9)
output = sys.argv[sys.argv.index('--output') + 1]
pathlib.Path(output).write_text('{}')
""",
        )
        systemd_mock = temp / "systemd-mock.py"
        write_executable(systemd_mock, "#!/usr/bin/env python3\n")
        run_dir = temp / "run"
        config_dir = temp / "config"
        run_dir.mkdir()
        config_dir.mkdir()
        server = HTTPServer(("127.0.0.1", 0), _HealthHandler)
        _HealthHandler.state_path = str(state_path)
        _HealthHandler.failure = failure
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        variables = {
            "container_name": "frontpage",
            "docker_image": "new-image",
            "previous_image": "previous-image",
            "previous_version": "b" * 40,
            "previous_observability_v2_enabled": False,
            "metrics_group_id": "20",
            "metrics_config_dir": str(config_dir),
            "observer_run_dir": str(run_dir),
            "observer_user": TEST_USER,
            "frontpage_observer_group": TEST_GROUP,
            "frontpage_facts_owner": TEST_USER,
            "frontpage_become": False,
            "frontpage_test_mode": True,
            "frontpage_systemd_mock_executable": str(systemd_mock),
            "frontpage_health_url": f"http://127.0.0.1:{server.server_port}/health",
            "frontpage_health_retries": 1,
            "frontpage_health_delay": 0,
            "frontpage_runtime_map_argv_prefix": [],
            "runtime_map_executable": str(runtime_map),
            "frontpage_new_env": {"VERSION": "a" * 40},
            "frontpage_new_volumes": ["data:/data", "metrics:/metrics:ro"],
            "frontpage_rollback_env": {"VERSION": "b" * 40},
            "frontpage_rollback_volumes": ["data:/data", "metrics:/metrics:ro"],
        }
        try:
            result = run_ansible(
                SWAP,
                variables,
                {
                    "ANSIBLE_COLLECTIONS_PATH": str(collection_root),
                    "MOCK_DOCKER_STATE": str(state_path),
                    "MOCK_DOCKER_FAILURE": failure,
                },
                temp,
            )
            state = json.loads(state_path.read_text())
            return result, state
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            temp_context.cleanup()

    def _preflight_run(self, valid: bool, previous_version: str = "b" * 40):
        temp_context = tempfile.TemporaryDirectory()
        temp = Path(temp_context.name)
        state_path = temp / "docker-state.json"
        state_path.write_text(json.dumps({"image": "previous-image", "events": []}))
        collection_root = self._write_mock_collection(temp)
        commit = "a" * 40
        variables = {
            "docker_image": f"ghcr.io/reedtrullz/frontpage:sha-{commit}" if valid else "invalid-image",
            "deploy_commit_sha": commit if valid else "bad",
            "previous_image": "previous-image",
            "previous_version": previous_version,
            "app_owner_github_id": "2069259",
            "metrics_group_id": "986",
            "observability_v2_enabled": False,
            "previous_observability_v2_enabled": False,
            "image_preloaded": True,
            "metrics_dir": "/var/lib/frontpage-metrics",
            "metrics_v1_dir": "/var/lib/frontpage-metrics/v1",
            "docker_volume_data": "frontpage_data",
            "vault_auth_secret": "test-auth",
            "vault_auth_github_id": "test-id",
            "vault_auth_github_secret": "test-secret",
            "vault_github_token": "test-token",
        }
        try:
            result = run_ansible(
                PREFLIGHT,
                variables,
                {
                    "ANSIBLE_COLLECTIONS_PATH": str(collection_root),
                    "MOCK_DOCKER_STATE": str(state_path),
                },
                temp,
            )
            return result
        finally:
            temp_context.cleanup()

    def test_actual_swap_tasks_restore_after_start_runtime_and_health_failures(self):
        for failure in ("start", "runtime-map", "health"):
            with self.subTest(failure=failure):
                result, state = self._swap_run(failure)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(state["image"], "previous-image")
                self.assertIn("start:previous-image", state["events"])

    def test_rollback_health_requires_captured_previous_full_version(self):
        result, state = self._swap_run("health-wrong-rollback-version")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(state["image"], "previous-image")
        self.assertIn("Deployment and rollback health or identity check failed", result.stdout + result.stderr)

    def test_new_container_health_requires_the_exact_requested_version(self):
        result, state = self._swap_run("health-wrong-new-version")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(state["image"], "previous-image")
        self.assertIn("Frontpage health or release identity check failed", result.stdout + result.stderr)
        self.assertNotIn("c" * 40, result.stdout + result.stderr)

    def test_actual_swap_tasks_report_rollback_failure(self):
        result, state = self._swap_run("rollback")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(state["image"], "new-image")
        self.assertIn("mock rollback failure", result.stdout + result.stderr)

    def test_actual_swap_tasks_report_rollback_health_failure(self):
        result, state = self._swap_run("health-rollback")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(state["image"], "previous-image")
        self.assertIn("Deployment and rollback health or identity check failed", result.stdout + result.stderr)

    def test_actual_preflight_accepts_valid_identity_and_rejects_invalid_identity(self):
        valid = self._preflight_run(True)
        self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)
        invalid = self._preflight_run(False)
        self.assertNotEqual(invalid.returncode, 0)

    def test_preflight_rejects_a_non_full_previous_rollback_version(self):
        result = self._preflight_run(True, previous_version="unknown")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Validate deployment and rollback facts before container stop", result.stdout + result.stderr)

    def test_playbook_wires_preflight_and_actual_swap_task_file(self):
        playbook = PLAYBOOK.read_text()
        preflight = PREFLIGHT.read_text()
        swap = SWAP.read_text()
        self.assertIn("ops/ansible/container-preflight.yml", playbook)
        self.assertIn("ops/ansible/container-swap.yml", playbook)
        self.assertIn("rescue:", swap)
        self.assertIn("Restore previous container after post-stop failure", swap)
        self.assertIn("Start new container", swap)
        self.assertIn("Validate deployment and rollback facts before container stop", preflight)
        self.assertLess(
            playbook.index("ops/ansible/container-preflight.yml"),
            playbook.index("ops/ansible/container-swap.yml"),
        )


if __name__ == "__main__":
    unittest.main()

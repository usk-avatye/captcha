"""Docker 경계만 대체해 시작 스크립트가 안내하는 실제 주소를 확인한다."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class LauncherTest(unittest.TestCase):
    def test_prints_configured_customer_port(self):
        sdk = Path(__file__).resolve().parents[1]
        artifacts = sdk / "artifacts"
        artifacts.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=artifacts) as temporary:
            root = Path(temporary)
            demo = root / "final_mission" / "demo"
            demo.mkdir(parents=True)
            customer = root / "Internship-finalproject" / "backend"
            customer.mkdir(parents=True)
            (customer / "alembic.ini").touch()
            for file in ("common.sh", "start.command"):
                shutil.copyfile(sdk / "demo" / file, demo / file)
            (demo / ".env").write_text("DEMO_IMAGE_TAG=local\nDEMO_CUSTOMER_WEB_PORT=55176\n")
            binaries = root / "bin"
            binaries.mkdir()
            docker = binaries / "docker"
            docker.write_text("#!/bin/sh\nexit 0\n")
            docker.chmod(0o755)
            result = subprocess.run(["bash", str(demo / "start.command")], capture_output=True, text=True,
                env={**os.environ, "PATH": str(binaries) + os.pathsep + os.environ["PATH"],
                     "DEMO_OPEN_BROWSER": "0"})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("http://127.0.0.1:55176/reservations", result.stdout)


if __name__ == "__main__":
    unittest.main()

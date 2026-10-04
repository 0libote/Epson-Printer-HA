import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scan-bridge' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
installer = load('installer', 'install_bundle.py')
scanner = load('scanner', 'scanner_service.py')

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def archive(self, entries):
        target = self.path / 'bundle.tar.gz'
        with tarfile.open(target, 'w:gz') as tar:
            for name, kind, content in entries:
                info = tarfile.TarInfo(name)
                info.type, info.size = kind, len(content)
                tar.addfile(info, io.BytesIO(content) if kind == tarfile.REGTYPE else None)
        return target
    def test_licence_required_even_if_already_installed(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(installer, 'installed', return_value=True):
            self.assertEqual(installer.main(), 3)
    def test_reject_architecture(self):
        with patch.object(installer.platform, 'machine', return_value='aarch64'):
            self.assertEqual(installer.main(), 3)
    def test_allowed_packages_flatten_only_regular_files(self):
        entries = [('root.deb', tarfile.DIRTYPE, b'')] + [(f'root/core/{name}', tarfile.REGTYPE, b'deb') for name, _ in installer.EXPECTED.values()]
        def metadata(path):
            package = next(k for k,v in installer.EXPECTED.items() if v[0] == path.name)
            return (package, installer.EXPECTED[package][1], 'amd64')
        with patch.object(installer, 'package_metadata', side_effect=metadata):
            result = installer.collect_debs(self.archive(entries), self.path)
        self.assertEqual(set(result), set(installer.EXPECTED))
        self.assertFalse((self.path / 'root').exists())
    def test_reject_unsafe_members(self):
        name = installer.EXPECTED['epsonscan2'][0]
        for entries in [
            [('../'+name, tarfile.REGTYPE, b'deb')],
            [('/'+name, tarfile.REGTYPE, b'deb')],
            [(name, tarfile.SYMTYPE, b'')],
            [('unknown.deb', tarfile.REGTYPE, b'deb')],
            [(name, tarfile.REGTYPE, b'deb'), (name, tarfile.REGTYPE, b'deb')],
        ]:
            with self.subTest(entries=entries), self.assertRaises(installer.PermanentSetupError):
                installer.collect_debs(self.archive(entries), self.path)
    def test_reject_wrong_package_version_or_arch(self):
        name = installer.EXPECTED['epsonscan2'][0]
        for metadata in [('epsonscan2','9.9','amd64'), ('epsonscan2','6.7.80.0-1','arm64'), ('evil','1','amd64')]:
            with patch.object(installer,'package_metadata',return_value=metadata), self.assertRaises(installer.PermanentSetupError):
                installer.collect_debs(self.archive([(name, tarfile.REGTYPE, b'deb')]), self.path)
    def test_limits_before_extraction(self):
        with patch.object(installer,'MAX_ARCHIVE_MEMBERS',0), self.assertRaises(installer.PermanentSetupError):
            installer.collect_debs(self.archive([('dir',tarfile.DIRTYPE,b'')]),self.path)
        name=installer.EXPECTED['epsonscan2'][0]
        with patch.object(installer,'MAX_DEB_BYTES',1), self.assertRaises(installer.PermanentSetupError):
            installer.collect_debs(self.archive([(name,tarfile.REGTYPE,b'deb')]),self.path)
    def test_download_checksum_and_redirect(self):
        class Response(io.BytesIO):
            headers = {}
            def geturl(self): return installer.BUNDLE_URL
        with patch.dict(os.environ, {'EPSON_EULA_ACCEPTED':'true'}), patch.object(installer.urllib.request,'urlopen',return_value=Response(b'wrong')):
            with self.assertRaises(installer.PermanentSetupError): installer.download_bundle(self.path/'bundle')
            self.assertFalse((self.path/'bundle').exists())
        class Redirect(Response):
            def geturl(self): return 'http://evil'
        with patch.dict(os.environ, {'EPSON_EULA_ACCEPTED':'true'}), patch.object(installer.urllib.request,'urlopen',return_value=Redirect(b'')):
            with self.assertRaises(installer.PermanentSetupError): installer.download_bundle(self.path/'bundle')

class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def settings(self, dpi=300, mode='Color'):
        return {'Resolution':dpi,'ColorType':scanner.MODES[mode],'FunctionalUnit':0,'FixedDocumentSize':1,
          'ImageFormat':4,'PagesTobeScanned':1,'Folder':101,'UserDefinePath':'/unsafe','FileNamePrefix':'../../evil'}
    def profiles(self):
        entries=[]
        for dpi in (150,300,600):
            for mode in scanner.MODES:
                name=f'{mode}-{dpi}.SF2'
                raw=json.dumps({'Preset':{'0':self.settings(dpi,mode)}}).encode()
                (self.path/name).write_bytes(raw)
                entries.append({'dpi':dpi,'mode':mode,'file':name,'sha256':hashlib.sha256(raw).hexdigest(),'validated':True})
        (self.path/'manifest.json').write_text(json.dumps({'version':scanner.VERSION,'printerAddress':'192.0.2.10','profiles':entries}))
        return entries
    def test_profile_combinations_and_private_output(self):
        self.profiles()
        profiles=scanner.load_profiles(self.path,scanner.VERSION)
        self.assertEqual(len(profiles),9)
        output=scanner.prepare_profile(profiles[0],self.path)
        settings=json.loads(output.read_text())['Preset']['0']
        self.assertEqual(settings['UserDefinePath'],str(self.path))
        self.assertEqual(settings['FileNamePrefix'],'scan')
    def test_profile_version_integrity_and_semantics(self):
        self.profiles()
        with self.assertRaises(ValueError): scanner.load_profiles(self.path,'9')
        (self.path/'Color-150.SF2').write_text('{}')
        with self.assertRaises(ValueError): scanner.load_profiles(self.path,scanner.VERSION)
        self.profiles()
        manifest=json.loads((self.path/'manifest.json').read_text())
        manifest['profiles'][0]['file']='../bad.SF2'
        (self.path/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError): scanner.load_profiles(self.path,scanner.VERSION)
    def test_missing_profiles_do_not_advertise_support(self):
        service=scanner.Service(scanner.load_profiles(self.path,scanner.VERSION))
        self.assertEqual(service.health()['capabilities']['resolutions'],[])
        with self.assertRaises(ValueError): service.start({'ip':'192.0.2.10','dpi':300,'mode':'Color'})
    def test_command_arguments_and_validation(self):
        self.assertEqual(scanner.scan_command('192.0.2.10',self.path/'job.SF2'),['epsonscan2','--scan','192.0.2.10',str(self.path/'job.SF2')])
        for ip in ('127.0.0.1','192.0.2.10;id','-x','999.1.1.1','01.2.3.4'):
            with self.assertRaises(ValueError): scanner.printer_ip(ip)
    def test_command_timeout_and_zero_exit_error(self):
        service=scanner.Service([])
        with self.assertRaises(scanner.CliFailure): service.command(['python3','-c','import time; time.sleep(20)'],timeout=0.05)
        with self.assertRaises(scanner.CliFailure): service.command(['python3','-c','print("ERROR : Device is not found...")'])
        with self.assertRaises(scanner.CliFailure): service.command(['python3','-c','print("x"*100000);print("ERROR : Offline")'])
        self.assertLessEqual(len(service.command(['python3','-c','print("x"*1000000)'])),8192)
    def test_status_offline_and_busy(self):
        service=scanner.Service([])
        with patch.object(service,'command',side_effect=scanner.CliFailure('offline')):
            self.assertFalse(service.status('192.0.2.10')['ok'])
        service.lock.acquire()
        self.assertEqual(service.status('192.0.2.10')['state'],'busy')
        service.lock.release()
    def test_scan_output_and_lock_lifetime(self):
        profile={'ip':'192.0.2.10','dpi':300,'mode':'Color','settings':self.settings()}
        service=scanner.Service([profile])
        def command(args, **kwargs):
            if '--scan' in args:
                time.sleep(0.03)
                (kwargs['cwd']/'scan.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture')
            return ''
        with patch.object(service,'command',side_effect=command):
            job_id=service.start({'ip':'192.0.2.10','dpi':300,'mode':'Color'})
            self.assertIsNone(service.start({'ip':'192.0.2.10','dpi':300,'mode':'Color'}))
            for _ in range(100):
                if service.jobs[job_id]['state']=='done': break
                time.sleep(.005)
            self.assertEqual(service.jobs[job_id]['state'],'done')
            self.assertFalse(service.lock.locked())
        shutil = __import__('shutil')
        shutil.rmtree(service.jobs[job_id]['directory'])
    def test_cancel_keeps_lock_until_process_settles(self):
        service=scanner.Service([])
        service.lock.acquire()
        job={'state':'scanning','cancelled':False}
        proc=subprocess.Popen(['python3','-c','import time;time.sleep(20)'],start_new_session=True)
        job['process']=proc
        service.cancel(job)
        self.assertTrue(service.lock.locked())
        proc.wait(timeout=3)
        service.lock.release()

if __name__ == '__main__': unittest.main()

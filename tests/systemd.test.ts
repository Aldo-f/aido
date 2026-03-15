import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

describe('systemd installation', () => {
  const PROJECT_ROOT = path.join(process.cwd());
  const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'contrib/aido.service.template');
  const WRAPPER_PATH = path.join(PROJECT_ROOT, 'contrib/aido-wrapper.sh');

  it('has systemd service template', () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it('has wrapper script', () => {
    expect(fs.existsSync(WRAPPER_PATH)).toBe(true);
  });

  it('wrapper script is executable', () => {
    const stats = fs.statSync(WRAPPER_PATH);
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable).toBe(true);
  });

  it('template contains required sections', () => {
    const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('[Unit]');
    expect(content).toContain('[Service]');
    expect(content).toContain('[Install]');
  });

  it('template has placeholders', () => {
    const content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('{AIDO_PATH}');
  });

  it('generates valid service file', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const aidoPath = PROJECT_ROOT;
    const user = os.userInfo().username;
    
    const serviceContent = template
      .replace(/{AIDO_PATH}/g, aidoPath)
      .replace(/{USER}/g, user);
    
    expect(serviceContent).toContain(`WorkingDirectory=${aidoPath}`);
    expect(serviceContent).toContain(`ExecStart=${aidoPath}/contrib/aido-wrapper.sh proxy`);
    expect(serviceContent).toContain('WantedBy=default.target');
  });

  it('service starts both proxy and hunt', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const aidoPath = PROJECT_ROOT;
    
    const serviceContent = template.replace(/{AIDO_PATH}/g, aidoPath);
    
    expect(serviceContent).toContain('ExecStartPost');
    expect(serviceContent).toContain('aido-wrapper.sh hunt');
  });

  it('package.json has install:systemd script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts['install:systemd']).toBeDefined();
    expect(pkg.scripts['install:systemd']).toContain('systemd');
  });
});

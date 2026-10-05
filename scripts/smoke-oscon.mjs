// Isolated UI smoke: no PLAY/STOP, no LiveBoard hardware, no production settings.
import { _electron as electron } from '@playwright/test'
import electronPath from 'electron'
import { createSocket } from 'node:dgram'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const corruptSettings = process.env.OSCON_SMOKE_CORRUPT_SETTINGS === '1'
const defaultFiles = ['playback.json', 'connection.json'].map(name => path.join(root, 'config', 'defaults', name))
const defaultsBefore = await Promise.all(defaultFiles.map(file => readFile(file, 'utf8')))
await mkdir(path.join(root, 'artifacts'), { recursive: true })
const directory = await mkdtemp(path.join(root, 'artifacts', 'smoke-'))
const settingsRoot = path.join(directory, 'settings')
const dataRoot = path.join(directory, 'output')
await mkdir(settingsRoot, { recursive: true })
const receiver = createSocket('udp4')
let datagrams = 0
receiver.on('message', () => { datagrams++ })
await new Promise(resolve => receiver.bind(0, '127.0.0.1', resolve))
const portProbe = createServer()
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve))
const httpPort = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
const token = 'b'.repeat(64)
await writeFile(path.join(settingsRoot, 'oscon-connection.json'), JSON.stringify({
  schemaVersion: 1, enabled: false, setupConfirmed: false, bindAddress: '127.0.0.1', port: httpPort,
  allowedOrigins: ['http://plasma.test'], token,
  receiver: { host: '127.0.0.1', port: receiver.address().port, addressPrefix: '/lvb/control/' },
}))
if (corruptSettings) {
  await writeFile(path.join(settingsRoot, 'oscon-connection.json'), '{broken')
  await writeFile(path.join(settingsRoot, 'lab-settings.json'), '{broken')
}
const environment = { ...process.env, OSCON_SMOKE: '1', OSCON_SETTINGS_ROOT: settingsRoot, OSCON_DATA_ROOT: dataRoot }
delete environment.ELECTRON_RUN_AS_NODE
let application
let mainPage
const pageErrors = []
try {
  application = await electron.launch({ executablePath: process.env.OSCON_EXECUTABLE || electronPath, args: process.env.OSCON_EXECUTABLE ? [] : ['.'], cwd: root, env: environment, timeout: 30_000 })
  const window = await application.firstWindow()
  mainPage = window
  // Windows only paints a BrowserWindow after it has been shown.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
  window.on('pageerror', error => pageErrors.push(error.message))
  await window.locator('.side-nav').waitFor({ timeout: 30_000 })
  const initial = await window.evaluate(() => window.labApi.getSnapshot())
  assert.equal(initial.templates.headline.state, 'UNKNOWN')
  assert.equal(initial.templates.name.state, 'UNKNOWN')
  assert.equal(await window.evaluate(() => typeof window.require), 'undefined')
  assert.equal((await window.evaluate(() => window.labApi.getBridgeInfo())).status, corruptSettings ? 'error' : 'offline')
  if (corruptSettings) {
    await assert.rejects(() => window.evaluate(() => window.labApi.regenerateBridgeToken()))
    assert.equal(await readFile(path.join(settingsRoot, 'oscon-connection.json'), 'utf8'), '{broken')
    assert.equal((await window.evaluate(() => window.labApi.getBridgeInfo())).status, 'error')
  }
  const playButtons = await window.getByRole('button', { name: /^PLAY / }).all()
  assert.ok(playButtons.length > 0)
  for (const button of playButtons) assert.equal(await button.isDisabled(), true)
  await window.screenshot({ path: path.join(directory, 'status.png') })
  await window.getByRole('button', { name: /Settings/ }).click()
  await window.getByRole('button', { name: 'Arată tokenul', exact: true }).waitFor()
  assert.equal(await window.locator('.revealed-secret').count(), 0)
  await window.screenshot({ path: path.join(directory, 'settings.png') })
  if (corruptSettings) {
    const saveConnection = window.getByRole('button', { name: 'Salvează conexiunea', exact: true })
    const saveSources = window.getByRole('button', { name: 'Salvează sursele', exact: true })
    assert.equal(await saveConnection.isDisabled(), false)
    assert.equal(await saveSources.isDisabled(), false)
    await saveConnection.click()
    await window.locator('.success-note').waitFor()
    await saveSources.click()
    await window.locator('.connection-state.offline').waitFor()
    assert.equal((await window.evaluate(() => window.labApi.getBridgeInfo())).error, null)
    const settings = await window.evaluate(() => window.labApi.getConnectionSettings())
    // Every later step remains confined to the test receivers, including after repair.
    await window.evaluate(value => window.labApi.setConnectionSettings(value), {
      ...settings, port: httpPort, receiver: { ...settings.receiver, host: '127.0.0.1', port: receiver.address().port },
    })
    await window.getByRole('button', { name: /Status/ }).click()
    await window.getByRole('button', { name: /Settings/ }).click()
  }
  await window.getByRole('button', { name: 'Arată tokenul', exact: true }).click()
  await window.locator('.revealed-secret input').waitFor()
  const accessToken = await window.locator('.revealed-secret input').inputValue()
  assert.match(accessToken, /^[0-9a-f]{64}$/i)
  if (!corruptSettings) assert.equal(accessToken, token)
  await window.getByRole('checkbox', { name: 'Activează API-ul pentru Plasma', exact: true }).check()
  await window.getByRole('checkbox', { name: 'Am verificat configurația conexiunii', exact: true }).check()
  await window.getByRole('button', { name: 'Salvează conexiunea', exact: true }).click()
  await window.locator('.connection-state.online').waitFor()
  await window.locator('.top-status .service-pill.online').waitFor()
  const endpoint = (await window.evaluate(() => window.labApi.getBridgeInfo())).endpoint
  const health = await fetch(`${endpoint}/v1/health`, { headers: { Origin: 'http://plasma.test', Authorization: `Bearer ${accessToken}` } })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).service, 'oscon')
  const rotated = await window.evaluate(() => window.labApi.regenerateBridgeToken())
  assert.notEqual(rotated, accessToken)
  assert.equal((await fetch(`${endpoint}/v1/health`, { headers: { Origin: 'http://plasma.test', Authorization: `Bearer ${accessToken}` } })).status, 401)
  assert.equal((await fetch(`${endpoint}/v1/health`, { headers: { Origin: 'http://plasma.test', Authorization: `Bearer ${rotated}` } })).status, 200)
  await window.getByRole('button', { name: /Diagnostic/ }).click()
  assert.equal(await window.locator('.page-scroll').evaluate(element => element.scrollTop), 0)
  assert.equal(await window.locator('.revealed-secret').count(), 0)
  await window.screenshot({ path: path.join(directory, 'diagnostic.png') })
  const nextWindow = application.waitForEvent('window')
  await window.getByRole('button', { name: /Preview/ }).click()
  const preview = await nextWindow
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle().includes('Preview'))?.show())
  await preview.locator('.preview-frame').waitFor()
  await preview.screenshot({ path: path.join(directory, 'preview.png') })
  await assert.rejects(() => preview.evaluate(() => window.labApi.revealBridgeToken()))
  assert.deepEqual(pageErrors, [])
  assert.equal(datagrams, 0)
  assert.deepEqual(await Promise.all(defaultFiles.map(file => readFile(file, 'utf8'))), defaultsBefore)
  console.log(JSON.stringify({ ok: true, directory, startup: 'UNKNOWN', api: 'offline → online', corruptSettingsRepaired: corruptSettings, tokenRotation: true, defaultsUnchanged: true, datagrams, pages: ['Status', 'Settings', 'Diagnostic', 'Preview'] }))
} catch (error) {
  const loading = mainPage ? await mainPage.locator('.app-loading').allTextContents().catch(() => []) : []
  console.error(JSON.stringify({ page: mainPage?.url(), loading, pageErrors }))
  throw error
} finally {
  await application?.close()
  await new Promise(resolve => receiver.close(resolve))
}

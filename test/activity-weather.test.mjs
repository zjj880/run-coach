import assert from 'node:assert/strict'
import test from 'node:test'
import { clearActivityWeatherCache, fetchActivityWeather, garminWeatherStart } from '../src/activityWeather.ts'
import { syncGarminDetails } from '../src/garmin.ts'
import { trainingReviewInput } from '../src/evaluation.ts'

test('hourly weather uses the UTC activity time and sends rounded coordinates only', async () => {
  const start = garminWeatherStart({ startLatitude: 31.231252, startLongitude: 121.470523,
    startTimeGMT: '2025-09-24 23:45:00', activityId: 810 })
  assert.equal(start.time.toISOString(), '2025-09-24T23:45:00.000Z')
  const conditions = await fetchActivityWeather(start, async (address, options) => {
    const query = new URL(address)
    assert.equal(query.host, 'historical-forecast-api.open-meteo.com')
    assert.equal(query.searchParams.get('latitude'), '31.23')
    assert.equal(query.searchParams.get('longitude'), '121.47')
    assert.equal(query.searchParams.get('start_hour'), '2025-09-25T00:00')
    assert.equal(query.searchParams.has('activityId'), false)
    assert.equal(options.headers, undefined)
    return Response.json({ hourly: { time: ['2025-09-25T00:00'], temperature_2m: [-4], relative_humidity_2m: [80] } })
  })
  assert.deepEqual(conditions, { temperatureC: -4, relativeHumidityPct: 80, sampleTimeUtc: '2025-09-25T00:00:00.000Z',
    source: 'Open-Meteo 小时天气估计' })
})

test('weather survives a FIT failure and the evaluation payload excludes the diagnostic and location', async () => {
  const [downloaded] = await syncGarminDetails('GCDC_' + 'A'.repeat(30), ['garmin-cn-88'], async (address, options) => {
    const url = new URL(address)
    if (url.pathname.endsWith('/token')) return new Response('synthetic-activity-test-token')
    if (url.pathname === '/activity-service/activity/88') return Response.json({
      summaryDTO: { startLatitude: 31.11334, startLongitude: 121.44336, startTimeGMT: '2025-09-24T12:18:00', maxHR: 153 },
    })
    if (url.pathname === '/download-service/files/activity/88') return new Response(null, { status: 503 })
    assert.equal(url.hostname, 'historical-forecast-api.open-meteo.com')
    assert.equal(options.headers, undefined)
    return Response.json({ hourly: { time: ['2025-09-24T12:00'], temperature_2m: [23.4], relative_humidity_2m: [89] } })
  })
  assert.match(downloaded.detail.fitIssue, /503/)
  assert.equal(downloaded.fit, undefined)
  const output = trainingReviewInput('2025-09-24', [], [{
    id: downloaded.id, date: '2025-09-24', title: '跑步', time: '20:18', role: '主课', minutes: 35, km: 5,
    detail: downloaded.detail,
  }]).activities[0]
  assert.equal(output.weather.temperatureC, 23.4)
  assert.equal(output.weather.relativeHumidityPct, 89)
  assert.deepEqual(output.detail, { maxHr: 153, runningCadenceSpm: undefined, strideLengthCm: undefined, elevationGainM: undefined,
    averagePowerW: undefined, movingSeconds: undefined, aerobicTrainingEffect: undefined, anaerobicTrainingEffect: undefined, segmentTotals: undefined })
  assert.doesNotMatch(JSON.stringify(output), /startLatitude|startLongitude|fitIssue/)
})

test('missing location, missing weather readings and wrong timestamps do not create conditions', async () => {
  const point = { startLatitude: 31.2, startLongitude: 121.5 }
  assert.equal(garminWeatherStart({ ...point, startTimeLocal: '2025-09-24 20:00:00' }), undefined)
  assert.equal(garminWeatherStart({ ...point, startLatitude: null, startTimeGMT: '2025-09-24 12:00:00' }), undefined)
  const start = garminWeatherStart({ ...point, startTimeGMT: '2025-09-24 12:00:00' })
  assert.equal(await fetchActivityWeather(start, async () => Response.json({ hourly: {
    time: ['2025-09-24T12:00'], temperature_2m: [22], relative_humidity_2m: [null],
  } })), undefined)
  assert.equal(await fetchActivityWeather(start, async () => Response.json({ hourly: {
    time: ['2025-09-24T13:00'], temperature_2m: [22], relative_humidity_2m: [70],
  } })), undefined)
})

test('repeat queries for the same rounded hour reuse the cached conditions', async () => {
  clearActivityWeatherCache()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return Response.json({ hourly: { time: ['2025-09-24T12:00'], temperature_2m: [21], relative_humidity_2m: [66] } })
  }
  const start = garminWeatherStart({ startLatitude: 31.234, startLongitude: 121.478, startTimeGMT: '2025-09-24 12:10:00' })
  const first = await fetchActivityWeather(start, fetcher)
  const second = await fetchActivityWeather(start, fetcher)
  assert.deepEqual(first, second)
  assert.equal(calls, 1)
  clearActivityWeatherCache()
})

test('disabling weather skips the third-party request entirely', async () => {
  const hosts = []
  const [downloaded] = await syncGarminDetails('GCDC_' + 'B'.repeat(30), ['garmin-cn-89'], async (address) => {
    const url = new URL(address)
    hosts.push(url.hostname)
    if (url.pathname.endsWith('/token')) return new Response('synthetic-activity-test-token')
    if (url.pathname === '/activity-service/activity/89') return Response.json({
      summaryDTO: { startLatitude: 31.1, startLongitude: 121.4, startTimeGMT: '2025-09-24T12:18:00' },
    })
    return new Response(null, { status: 404 })
  }, { weather: false })
  assert.equal(downloaded.detail.weather, undefined)
  assert.equal(hosts.some((host) => /open-meteo/.test(host)), false)
})

test('FIT downloads follow a redirect only to another Garmin host', async () => {
  const seen = []
  const fetcher = async (address) => {
    const url = new URL(address)
    seen.push(url.hostname)
    if (url.pathname.endsWith('/token')) return new Response('synthetic-activity-test-token')
    if (url.pathname === '/activity-service/activity/91') return Response.json({ summaryDTO: {} })
    if (url.hostname === 'personal.connectapi.garmin.cn') {
      return new Response(null, { status: 302, headers: { location: 'https://download.garmin.cn/files/91.fit' } })
    }
    if (url.hostname === 'download.garmin.cn') return new Response(new Uint8Array(0), { status: 200 })
    throw new Error('unexpected ' + address)
  }
  const [record] = await syncGarminDetails('GCDC_' + 'D'.repeat(30), ['garmin-cn-91'], fetcher)
  assert.equal(seen.includes('download.garmin.cn'), true)
  assert.match(record.detail.fitIssue, /已下载/)
})

test('FIT redirects to a non-Garmin host are blocked', async () => {
  const fetcher = async (address) => {
    const url = new URL(address)
    if (url.pathname.endsWith('/token')) return new Response('synthetic-activity-test-token')
    if (url.pathname === '/activity-service/activity/90') return Response.json({ summaryDTO: {} })
    if (url.pathname === '/download-service/files/activity/90') {
      return new Response(null, { status: 302, headers: { location: 'https://example.invalid/steal.fit' } })
    }
    throw new Error('unexpected ' + address)
  }
  const [record] = await syncGarminDetails('GCDC_' + 'C'.repeat(30), ['garmin-cn-90'], fetcher)
  assert.match(record.detail.fitIssue, /非佳明域名/)
})

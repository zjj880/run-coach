export type ActivityWeather = {
  temperatureC: number
  relativeHumidityPct: number
  sampleTimeUtc: string
  source: 'Open-Meteo 小时天气估计'
}

type WeatherStart = { latitude: number; longitude: number; time: Date }

const weatherVariables = 'temperature_2m,relative_humidity_2m'
const historical = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
const recentForecast = 'https://api.open-meteo.com/v1/forecast'
const hourMs = 60 * 60 * 1000

/** 同一取整坐标 + 整点时段的天气只查询一次；进程内缓存，重启后重新获取。 */
const weatherCache = new Map<string, ActivityWeather>()
const weatherCacheLimit = 200

export function clearActivityWeatherCache() {
  weatherCache.clear()
}

function finiteBetween(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

export function garminWeatherStart(row: Record<string, unknown>): WeatherStart | undefined {
  const { startLatitude, startLongitude, startTimeGMT } = row
  if (!finiteBetween(startLatitude, -90, 90) || !finiteBetween(startLongitude, -180, 180) ||
    (startLatitude === 0 && startLongitude === 0) || typeof startTimeGMT !== 'string') return
  const input = startTimeGMT.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(input)) return
  const time = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(input) ? input : input + 'Z')
  if (!Number.isFinite(time.getTime())) return
  return { latitude: startLatitude, longitude: startLongitude, time }
}

export async function fetchActivityWeather(start: WeatherStart, fetcher: typeof fetch = fetch): Promise<ActivityWeather | undefined> {
  const timestamp = start.time.getTime()
  if (timestamp > Date.now() + hourMs) return
  const sampleTime = new Date(Math.round(timestamp / hourMs) * hourMs)
  const stamp = sampleTime.toISOString().slice(0, 16)
  const cacheKey = start.latitude.toFixed(2) + ',' + start.longitude.toFixed(2) + ',' + stamp
  const cached = weatherCache.get(cacheKey)
  if (cached) return cached
  const parameters = new URLSearchParams({
    latitude: start.latitude.toFixed(2), longitude: start.longitude.toFixed(2),
    timezone: 'GMT', hourly: weatherVariables, start_hour: stamp, end_hour: stamp,
  })
  for (const host of Date.now() - timestamp < 7 * 24 * hourMs ? [historical, recentForecast] : [historical]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4500)
    try {
      const response = await fetcher(host + '?' + parameters.toString(), { signal: controller.signal, redirect: 'error' })
      if (!response.ok) continue
      const { hourly } = await response.json()
      const index = Array.isArray(hourly?.time) ? hourly.time.indexOf(stamp) : -1
      if (index < 0) continue
      const temperature = hourly.temperature_2m?.[index]
      const humidity = hourly.relative_humidity_2m?.[index]
      if (finiteBetween(temperature, -100, 70) && finiteBetween(humidity, 0, 100)) {
        const weather: ActivityWeather = { temperatureC: temperature, relativeHumidityPct: humidity, sampleTimeUtc: sampleTime.toISOString(),
          source: 'Open-Meteo 小时天气估计' }
        weatherCache.set(cacheKey, weather)
        if (weatherCache.size > weatherCacheLimit) {
          const oldest = weatherCache.keys().next().value
          if (oldest !== undefined) weatherCache.delete(oldest)
        }
        return weather
      }
    } catch {
      // An unavailable weather service should not stop a training sync or overwrite a saved value.
    } finally { clearTimeout(timer) }
  }
}

import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_SERVICE_WORKER_SCOPE,
  LOCAL_SERVICE_WORKER_URL,
  registerLocalServiceWorker,
  shouldRegisterLocalServiceWorker,
} from '@/components/LocalServiceWorkerRegister'

describe('LocalServiceWorkerRegister helpers', () => {
  it('registers only for production secure contexts with service worker support', () => {
    expect(shouldRegisterLocalServiceWorker({
      nodeEnv: 'production',
      secureContext: true,
      serviceWorkerSupported: true,
    })).toBe(true)

    expect(shouldRegisterLocalServiceWorker({
      nodeEnv: 'development',
      secureContext: true,
      serviceWorkerSupported: true,
    })).toBe(false)

    expect(shouldRegisterLocalServiceWorker({
      nodeEnv: 'production',
      secureContext: false,
      serviceWorkerSupported: true,
    })).toBe(false)

    expect(shouldRegisterLocalServiceWorker({
      nodeEnv: 'production',
      secureContext: true,
      serviceWorkerSupported: false,
    })).toBe(false)
  })

  it('registers the local service worker with root scope', async () => {
    const registration = {} as ServiceWorkerRegistration
    const serviceWorker = {
      register: vi.fn().mockResolvedValue(registration),
    }

    await expect(registerLocalServiceWorker(serviceWorker)).resolves.toBe(registration)
    expect(serviceWorker.register).toHaveBeenCalledWith(LOCAL_SERVICE_WORKER_URL, {
      scope: LOCAL_SERVICE_WORKER_SCOPE,
    })
  })
})

'use client'

import { useEffect } from 'react'
import { logWarn } from '@/lib/utils/logger'

export const LOCAL_SERVICE_WORKER_URL = '/dwa-service-worker.js'
export const LOCAL_SERVICE_WORKER_SCOPE = '/'

interface LocalServiceWorkerRuntime {
  nodeEnv?: string
  secureContext: boolean
  serviceWorkerSupported: boolean
}

type ServiceWorkerRegistrar = Pick<ServiceWorkerContainer, 'register'>

export function shouldRegisterLocalServiceWorker({
  nodeEnv = process.env.NODE_ENV,
  secureContext,
  serviceWorkerSupported,
}: LocalServiceWorkerRuntime): boolean {
  return nodeEnv === 'production' && secureContext && serviceWorkerSupported
}

export function registerLocalServiceWorker(
  serviceWorker: ServiceWorkerRegistrar,
): Promise<ServiceWorkerRegistration> {
  return serviceWorker.register(LOCAL_SERVICE_WORKER_URL, {
    scope: LOCAL_SERVICE_WORKER_SCOPE,
  })
}

export function LocalServiceWorkerRegister() {
  useEffect(() => {
    const serviceWorkerSupported = 'serviceWorker' in window.navigator
    if (!shouldRegisterLocalServiceWorker({
      secureContext: window.isSecureContext,
      serviceWorkerSupported,
    })) return

    void registerLocalServiceWorker(window.navigator.serviceWorker)
      .catch((error: unknown) => {
        logWarn(
          '[ServiceWorker] Registration failed:',
          error instanceof Error ? error.message : error,
        )
      })
  }, [])

  return null
}

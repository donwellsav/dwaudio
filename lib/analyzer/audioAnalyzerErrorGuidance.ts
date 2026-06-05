interface AudioAnalyzerErrorGuidanceOptions {
  protocol?: string
  hostname?: string
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function getAudioAnalyzerErrorGuidance(
  error: string,
  options: AudioAnalyzerErrorGuidanceOptions = {},
): string {
  const { protocol, hostname } = options

  if (protocol != null && hostname != null && protocol !== 'https:' && !LOCAL_HOSTNAMES.has(hostname)) {
    return 'Microphone requires a secure (HTTPS) connection. Ask your admin to enable HTTPS.'
  }

  const lower = error.toLowerCase()

  if (lower.includes('permission') || lower.includes('not allowed')) {
    return "Click the mic icon in your browser's address bar to allow access, or check Settings > Privacy > Microphone."
  }
  if (lower.includes('abort')) {
    return 'Microphone request was cancelled. Click Start to try again.'
  }
  if (lower.includes('not found') || lower.includes('no microphone')) {
    return 'No microphone detected. Connect one and try again.'
  }
  if (lower.includes('in use') || lower.includes('not readable')) {
    return 'Another app is using your microphone. Close it, then try again.'
  }
  if (lower.includes('overconstrained')) {
    return "Your mic doesn't support the requested format. Try a different device."
  }
  if (lower.includes('suspend') || lower.includes('resume')) {
    return 'Audio was interrupted when the tab went to the background. Click Start to resume.'
  }

  return 'Check your microphone connection and browser permissions.'
}

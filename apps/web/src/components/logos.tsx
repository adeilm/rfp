// Simplified brand marks of the cloud and AI providers on the Pricing page (inline SVG: the app loads no external images).

type LogoProps = { size?: number; className?: string }

export function AzureLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className={className} aria-label="Microsoft Azure" role="img">
      <defs>
        <linearGradient id="az-a" x1="58" y1="7" x2="25" y2="90" gradientUnits="userSpaceOnUse"><stop stopColor="#114a8b" /><stop offset="1" stopColor="#0669bc" /></linearGradient>
        <linearGradient id="az-b" x1="47" y1="7" x2="82" y2="88" gradientUnits="userSpaceOnUse"><stop stopColor="#3ccbf4" /><stop offset="1" stopColor="#2892df" /></linearGradient>
      </defs>
      <path d="M33.3 6.5h26.4L32.3 87.8a4.2 4.2 0 0 1-4 2.9H7.8a4.2 4.2 0 0 1-4-5.6L29.3 9.4a4.2 4.2 0 0 1 4-2.9z" fill="url(#az-a)" />
      <path d="M71.6 61.1H29.7a1.9 1.9 0 0 0-1.3 3.3l26.9 25.1a4.2 4.2 0 0 0 2.9 1.2h23.7z" fill="#0078d4" />
      <path d="M66.6 9.4a4.2 4.2 0 0 0-4-2.9H33.2a4.2 4.2 0 0 1 4 2.9l25.5 75.7a4.2 4.2 0 0 1-4 5.6h29.4a4.2 4.2 0 0 0 4-5.6z" fill="url(#az-b)" />
    </svg>
  )
}

export function GoogleCloudLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 52" className={className} aria-label="Google Cloud" role="img">
      <path d="M40.6 14.3h2.1l5.9-5.9.3-2.5A26.5 26.5 0 0 0 5.8 18.8a3.2 3.2 0 0 1 2.1-.1l11.8-2s.6-1 .9-.9a14.7 14.7 0 0 1 20.1-1.5z" fill="#ea4335" />
      <path d="M57 18.8a26.6 26.6 0 0 0-8-12.9l-8.3 8.3a14.7 14.7 0 0 1 5.4 11.7v1.5a7.4 7.4 0 1 1 0 14.7H31.4l-1.5 1.5v8.8l1.5 1.5h14.7A19.1 19.1 0 0 0 57 18.8z" fill="#4285f4" />
      <path d="M16.6 52h14.7V40.2H16.6a7.3 7.3 0 0 1-3-.7l-2.1.6-5.9 5.9-.5 2.1A19 19 0 0 0 16.6 52z" fill="#34a853" />
      <path d="M16.6 13.7A19.1 19.1 0 0 0 5.1 47.9l8.5-8.5a7.4 7.4 0 1 1 9.7-9.7l8.5-8.5a19.1 19.1 0 0 0-15.2-7.5z" fill="#fbbc05" />
    </svg>
  )
}

export function AwsLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size * 1.4} height={size} viewBox="0 0 70 50" className={className} aria-label="Amazon Web Services" role="img">
      <text x="35" y="27" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="26" fill="#232f3e">aws</text>
      <path d="M10 35c14 9 36 9 50 0" stroke="#ff9900" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M54 31l7 3-4 6" stroke="#ff9900" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function OracleLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size * 1.4} height={size} viewBox="0 0 70 50" className={className} aria-label="Oracle Cloud" role="img">
      <rect x="6" y="10" width="58" height="30" rx="15" fill="none" stroke="#c74634" strokeWidth="8" />
    </svg>
  )
}

export function AnthropicLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-label="Anthropic" role="img">
      <rect width="48" height="48" rx="10" fill="#d97757" />
      <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
        {[0, 30, 60, 90, 120, 150].map(a => <line key={a} x1="24" y1="11" x2="24" y2="37" transform={`rotate(${a} 24 24)`} />)}
      </g>
    </svg>
  )
}

export function OpenAiLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-label="OpenAI" role="img">
      <rect width="48" height="48" rx="10" fill="#111" />
      <g fill="none" stroke="#fff" strokeWidth="3.2">
        {[0, 60, 120].map(a => <ellipse key={a} cx="24" cy="24" rx="13" ry="6.5" transform={`rotate(${a} 24 24)`} />)}
      </g>
    </svg>
  )
}

export function GeminiLogo({ size = 20, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-label="Google Gemini" role="img">
      <defs>
        <linearGradient id="gem" x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse"><stop stopColor="#1c7df0" /><stop offset=".55" stopColor="#7b6ff2" /><stop offset="1" stopColor="#e86c8f" /></linearGradient>
      </defs>
      <path d="M24 3c1.6 11.2 9.8 19.4 21 21-11.2 1.6-19.4 9.8-21 21-1.6-11.2-9.8-19.4-21-21C14.2 22.4 22.4 14.2 24 3z" fill="url(#gem)" />
    </svg>
  )
}

/** The logo of a cloud provider key of the pricing file (azure, gcp, aws, oracle), else nothing. */
export function CloudLogo({ provider, size }: { provider: string; size?: number }) {
  const L = ({ azure: AzureLogo, gcp: GoogleCloudLogo, aws: AwsLogo, oracle: OracleLogo } as Record<string, typeof AzureLogo>)[provider]
  return L ? <L size={size} className="shrink-0" /> : null
}

/** The logo of an AI provider name of the pricing file (Anthropic, OpenAI, Google), else nothing. */
export function AiLogo({ provider, size }: { provider: string; size?: number }) {
  const L = ({ anthropic: AnthropicLogo, openai: OpenAiLogo, google: GeminiLogo } as Record<string, typeof AzureLogo>)[provider.toLowerCase()]
  return L ? <L size={size} className="shrink-0" /> : null
}

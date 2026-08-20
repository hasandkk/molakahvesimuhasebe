import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { Button, ErrorBox, Field, Input } from '../components/ui'
import { LogoBadge } from '../components/Logo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError('Giriş yapılamadı: ' + errorMessage(error))
    setBusy(false)
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-stone-100 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <LogoBadge className="h-16 w-16" />
          <h1 className="mt-3 text-lg font-semibold text-stone-900">Mola Kahvesi</h1>
          <p className="text-sm text-stone-500">Stand yönetim paneli</p>
        </div>

        {error && <ErrorBox message={error} />}

        <Field label="E-posta">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Şifre">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </Button>

        <p className="text-center text-xs text-stone-500">
          Hesaplar Supabase panelinden (Authentication &gt; Users) açılır.
        </p>
      </form>
    </div>
  )
}

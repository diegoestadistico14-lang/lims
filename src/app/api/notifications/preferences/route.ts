import { withAuth } from '@/lib/auth/api-auth'
import { NextResponse } from 'next/server'

export const GET = withAuth(async (_request, { user, supabase }) => {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || {
    user_id: user.id,
    email_notifications: true,
    new_results: true,
    sla_reminders: false,
    sample_status_changes: true
  })
})

export const PUT = withAuth(async (request, { user, supabase }) => {
  const body = await request.json()
  const { email_notifications, new_results, sla_reminders, sample_status_changes } = body

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: user.id,
      email_notifications: email_notifications ?? true,
      new_results: new_results ?? true,
      sla_reminders: sla_reminders ?? false,
      sample_status_changes: sample_status_changes ?? true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
})

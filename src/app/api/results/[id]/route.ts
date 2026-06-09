import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/api-auth'
import { notifyResultsReady } from '@/lib/services/notificationService'

export const GET = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    // Get user's company_id from users table
    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const { data, error } = await supabase
      .from('results')
      .select(`
        *,
        sample_tests (
          id,
          test_catalog (id, name, area, code),
          methods (id, name, code)
        ),
        samples (
          id,
          code,
          species,
          variety,
          received_date,
          company_id,
          clients (id, name, contact_email),
          projects (id, name)
        ),
        performed_by_user:users!performed_by (id, name, email),
        validated_by_user:users!validated_by (id, name, email)
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Result not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Check if user has access to this result (via sample company)
    if (userData?.company_id && data.samples?.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching result:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

export const PUT = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    // Get user's company_id from users table
    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const body = await request.json()
    
    // Extract updatable fields
    const {
      sample_id,
      sample_test_id,
      report_id,
      test_area,
      methodology,
      findings,
      conclusion,
      diagnosis,
      pathogen_identified,
      pathogen_type,
      severity,
      confidence,
      result_type,
      recommendations,
      status,
      performed_by,
      performed_at,
      validated_by,
      validation_date
    } = body

    // First, get the current result to check access
    const { data: currentResult, error: fetchError } = await supabase
      .from('results')
      .select(`
        *,
        samples!inner (company_id)
      `)
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: 'Result not found' }, { status: 404 })
    }

    // Check access
    if (userData?.company_id && currentResult.samples?.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if result is validated - prevent editing
    if (currentResult.status === 'validated') {
      return NextResponse.json(
        { error: 'Este resultado no puede ser editado porque ya está validado.' },
        { status: 403 }
      )
    }

    const updateData: Record<string, unknown> = {}

    // Required fields
    if (sample_id !== undefined) {
      if (!sample_id) {
        return NextResponse.json({ error: 'sample_id is required' }, { status: 400 })
      }
      updateData.sample_id = sample_id
    }

    // Optional fields
    if (sample_test_id !== undefined) updateData.sample_test_id = sample_test_id || null
    if (report_id !== undefined) updateData.report_id = report_id || null
    if (test_area !== undefined) updateData.test_area = test_area || null
    if (methodology !== undefined) updateData.methodology = methodology || null
    if (findings !== undefined) updateData.findings = findings
    if (conclusion !== undefined) updateData.conclusion = conclusion || null
    if (diagnosis !== undefined) updateData.diagnosis = diagnosis || null
    if (pathogen_identified !== undefined) updateData.pathogen_identified = pathogen_identified || null
    if (pathogen_type !== undefined) updateData.pathogen_type = pathogen_type || null
    if (severity !== undefined) updateData.severity = severity || null
    if (confidence !== undefined) updateData.confidence = confidence || null
    if (result_type !== undefined) updateData.result_type = result_type || null
    if (recommendations !== undefined) updateData.recommendations = recommendations || null
    if (performed_by !== undefined) updateData.performed_by = performed_by || null
    if (performed_at !== undefined) updateData.performed_at = performed_at || null
    
    // Handle status and validation
    if (status !== undefined) {
      updateData.status = status
      // If status is validated and validated_by is not set, use current user
      if (status === 'validated' && !currentResult.validated_by && validated_by === undefined) {
        updateData.validated_by = user.id
        updateData.validation_date = new Date().toISOString()
      }
    }

    // Handle validation fields
    if (validated_by !== undefined) {
      updateData.validated_by = validated_by || null
      // If validated_by is set and validation_date is not provided, set current date
      if (validated_by && validation_date === undefined) {
        updateData.validation_date = new Date().toISOString()
      }
    }
    if (validation_date !== undefined) {
      updateData.validation_date = validation_date || null
    }

    // Always update updated_at
    updateData.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('results')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        sample_tests (
          id,
          test_catalog (id, name, area),
          methods (id, name)
        ),
        samples (
          id,
          code,
          species,
          clients (id, name, contact_email)
        ),
        performed_by_user:users!performed_by (id, name, email),
        validated_by_user:users!validated_by (id, name, email)
      `)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Send notification when result is validated
    if (status === 'validated' && currentResult.status !== 'validated') {
      const sample = (data as Record<string, unknown>)?.samples as Record<string, unknown>
      const client = sample?.clients as { id?: string; name?: string; contact_email?: string } | null
      if (client?.contact_email) {
        notifyResultsReady({
          sampleId: sample?.id as string,
          sampleCode: sample?.code as string,
          clientEmail: client.contact_email,
          clientName: client.name || 'Cliente',
          species: sample?.species as string,
          diagnosis: (data as Record<string, unknown>).diagnosis as string,
          pathogen: (data as Record<string, unknown>).pathogen_identified as string,
          recommendations: (data as Record<string, unknown>).recommendations as string,
          conclusion: (data as Record<string, unknown>).conclusion as string
        }).catch(err => console.error('Notification failed:', err))
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating result:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

export const PATCH = PUT

export const DELETE = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    // Get user's company_id from users table
    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    // First, get the result to check access
    const { data: currentResult, error: fetchError } = await supabase
      .from('results')
      .select(`
        *,
        samples!inner (company_id)
      `)
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: 'Result not found' }, { status: 404 })
    }

    // Check access
    if (userData?.company_id && currentResult.samples?.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Only allow deletion if result is not validated
    if (currentResult.status === 'validated') {
      return NextResponse.json({ error: 'Cannot delete validated results' }, { status: 403 })
    }

    const { error } = await supabase
      .from('results')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Result deleted successfully' })
  } catch (error) {
    console.error('Error deleting result:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/api-auth'
import { notifyStatusChange } from '@/lib/services/notificationService'

export const GET = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const { data, error } = await supabase
      .from('samples')
      .select(`
        *,
        clients (id, name, rut, contact_email),
        projects (id, name, code),
        sample_tests (
          id,
          test_catalog (id, code, name, area),
          methods (id, code, name, matrix)
        ),
        sample_units (
          id,
          code,
          label,
          unit_results (
            id,
            test_id,
            method_id,
            analyte,
            result_value,
            result_flag,
            notes,
            test_catalog (id, name, area),
            methods (id, name)
          )
        ),
        applied_interpretations (
          id,
          message,
          severity,
          created_at,
          interpretation_rules (id, area, analyte, message)
        ),
        reports (
          id,
          status,
          version,
          created_at,
          rendered_pdf_url,
          download_url,
          visibility
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (userData?.company_id && data.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching sample:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const PUT = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const body = await request.json()
    const {
      client_id, code, received_date, sla_type, sla_status, project_id,
      species, variety, rootstock, organo_analizado, planting_year, previous_crop, next_crop,
      fallow, client_notes, reception_notes, taken_by, sampling_method,
      suspected_pathogen, region, locality, sampling_observations,
      reception_observations, status
    } = body

    const { data: currentSample, error: fetchError } = await supabase
      .from('samples')
      .select('status, company_id')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
    }

    if (userData?.company_id && currentSample.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {}

    if (client_id !== undefined) updateData.client_id = client_id
    if (code !== undefined) updateData.code = code
    if (received_date !== undefined) {
      updateData.received_date = received_date
      updateData.received_at = new Date(received_date).toISOString()
      const slaType = sla_type || 'normal'
      const receivedAt = new Date(received_date)
      const dueDate = new Date(receivedAt)
      const businessDaysToAdd = slaType === 'express' ? 4 : 9
      let addedDays = 0
      while (addedDays < businessDaysToAdd) {
        dueDate.setDate(dueDate.getDate() + 1)
        if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) addedDays++
      }
      updateData.due_date = dueDate.toISOString().split('T')[0]
    }
    if (sla_type !== undefined) updateData.sla_type = sla_type
    if (sla_status !== undefined) updateData.sla_status = sla_status
    if (project_id !== undefined) updateData.project_id = project_id
    if (species !== undefined) updateData.species = species
    if (variety !== undefined) updateData.variety = variety
    if (rootstock !== undefined) updateData.rootstock = rootstock
    if (organo_analizado !== undefined) updateData.organo_analizado = organo_analizado
    if (planting_year !== undefined) updateData.planting_year = planting_year ? parseInt(planting_year) : null
    if (previous_crop !== undefined) updateData.previous_crop = previous_crop
    if (next_crop !== undefined) updateData.next_crop = next_crop
    if (fallow !== undefined) updateData.fallow = fallow
    if (client_notes !== undefined) updateData.client_notes = client_notes
    if (reception_notes !== undefined) updateData.reception_notes = reception_notes
    if (taken_by !== undefined) updateData.taken_by = taken_by
    if (sampling_method !== undefined) updateData.sampling_method = sampling_method
    if (suspected_pathogen !== undefined) updateData.suspected_pathogen = suspected_pathogen
    if (region !== undefined) updateData.region = region
    if (locality !== undefined) updateData.locality = locality
    if (sampling_observations !== undefined) updateData.sampling_observations = sampling_observations
    if (reception_observations !== undefined) updateData.reception_observations = reception_observations
    if (status !== undefined) updateData.status = status
    updateData.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('samples')
      .update(updateData)
      .eq('id', id)
      .select(`*, clients (id, name), projects (id, name)`)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (status && status !== currentSample.status) {
      await supabase
        .from('sample_status_transitions')
        .insert({
          sample_id: id,
          from_status: currentSample.status,
          to_status: status,
          by_user: user.id,
          reason: 'Status updated via API'
        })

      // Send email notification
      const client = (data as Record<string, unknown>)?.clients as { id?: string; name?: string; contact_email?: string; rut?: string } | null
      if (client?.contact_email) {
        notifyStatusChange({
          sampleId: id,
          sampleCode: (data as Record<string, unknown>).code as string,
          newStatus: status,
          clientEmail: client.contact_email,
          clientName: client.name || 'Cliente',
          species: (data as Record<string, unknown>).species as string,
          variety: (data as Record<string, unknown>).variety as string
        }).catch(err => console.error('Notification failed:', err))
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating sample:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const PATCH = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const body = await request.json()
    const {
      client_id, code, received_date, sla_type, sla_status, project_id,
      species, variety, rootstock, organo_analizado, planting_year, previous_crop, next_crop,
      fallow, client_notes, reception_notes, taken_by, sampling_method,
      suspected_pathogen, region, locality, sampling_observations,
      reception_observations, status
    } = body

    const { data: currentSample, error: fetchError } = await supabase
      .from('samples')
      .select('status, company_id')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
    }

    if (userData?.company_id && currentSample.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if sample has validated results
    const { data: validatedResults, error: resultsCheckError } = await supabase
      .from('results')
      .select('id')
      .eq('sample_id', id)
      .eq('status', 'validated')
      .limit(1)

    if (resultsCheckError) {
      console.error('Error checking validated results:', resultsCheckError)
    }

    const hasValidatedResults = validatedResults && validatedResults.length > 0

    if (hasValidatedResults) {
      const allowedFields = ['status', 'sla_status', 'due_date', 'client_notes', 'reception_notes', 'sampling_observations', 'reception_observations']
      const blockedFields = ['code', 'species', 'client_id', 'received_date', 'variety', 'rootstock', 'organo_analizado', 'planting_year', 'previous_crop', 'next_crop', 'fallow', 'project_id', 'sla_type', 'region', 'locality', 'taken_by', 'sampling_method', 'suspected_pathogen']
      const bodyKeys = Object.keys(body)
      const modifiedBlockedFields = bodyKeys.filter(key => blockedFields.includes(key))

      if (modifiedBlockedFields.length > 0) {
        return NextResponse.json(
          {
            error: `No se pueden editar los siguientes campos cuando hay resultados validados: ${modifiedBlockedFields.join(', ')}. ` +
                   'Solo se pueden editar: Estado, Estado SLA, Fecha de vencimiento y Notas.'
          },
          { status: 403 }
        )
      }
    } else {
      if (!client_id || !code || !received_date || !species) {
        return NextResponse.json(
          { error: 'client_id, code, received_date, and species are required' },
          { status: 400 }
        )
      }
    }

    let updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (hasValidatedResults) {
      if (body.status !== undefined) updateData.status = body.status || 'received'
      if (body.sla_status !== undefined) updateData.sla_status = body.sla_status || 'on_time'
      if (body.due_date !== undefined) updateData.due_date = body.due_date
      if (body.client_notes !== undefined) updateData.client_notes = body.client_notes || null
      if (body.reception_notes !== undefined) updateData.reception_notes = body.reception_notes || null
      if (body.sampling_observations !== undefined) updateData.sampling_observations = body.sampling_observations || null
      if (body.reception_observations !== undefined) updateData.reception_observations = body.reception_observations || null
    } else {
      const receivedAt = new Date(received_date)
      const dueDate = new Date(receivedAt)
      const businessDaysToAdd = sla_type === 'express' ? 4 : 9
      let addedDays = 0
      while (addedDays < businessDaysToAdd) {
        dueDate.setDate(dueDate.getDate() + 1)
        if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) addedDays++
      }

      updateData = {
        client_id, code, received_date,
        received_at: new Date(received_date).toISOString(),
        sla_type: sla_type || 'normal',
        sla_status: sla_status || 'on_time',
        due_date: dueDate.toISOString().split('T')[0],
        project_id: project_id || null,
        species,
        variety: variety || null,
        rootstock: rootstock || null,
        organo_analizado: organo_analizado || null,
        planting_year: planting_year ? parseInt(planting_year) : null,
        previous_crop: previous_crop || null,
        next_crop: next_crop || null,
        fallow: fallow || false,
        client_notes: client_notes || null,
        reception_notes: reception_notes || null,
        taken_by: taken_by || 'client',
        sampling_method: sampling_method || null,
        suspected_pathogen: suspected_pathogen || null,
        region: region || null,
        locality: locality || null,
        sampling_observations: sampling_observations || null,
        reception_observations: reception_observations || null,
        status: status || 'received',
        updated_at: new Date().toISOString()
      }
    }

    const { data, error } = await supabase
      .from('samples')
      .update(updateData)
      .eq('id', id)
      .select(`*, clients (id, name, contact_email), projects (id, name), sample_tests (id, test_catalog (id, name, area), methods (id, name))`)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const newStatus = hasValidatedResults ? body.status : status
    if (newStatus && newStatus !== currentSample.status) {
      await supabase
        .from('sample_status_transitions')
        .insert({
          sample_id: id,
          from_status: currentSample.status,
          to_status: newStatus,
          by_user: user.id,
          reason: 'Status updated via PATCH API'
        })

      const client = (data as Record<string, unknown>)?.clients as { id?: string; name?: string; contact_email?: string } | null
      if (client?.contact_email) {
        notifyStatusChange({
          sampleId: id,
          sampleCode: (data as Record<string, unknown>).code as string,
          newStatus,
          clientEmail: client.contact_email,
          clientName: client.name || 'Cliente',
          species: (data as Record<string, unknown>).species as string,
          variety: (data as Record<string, unknown>).variety as string
        }).catch(err => console.error('Notification failed:', err))
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating sample:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withAuth(async (request, { user, supabase, params }) => {
  try {
    const { id } = await (params as Promise<{ id: string }>)

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const { data: currentSample, error: fetchError } = await supabase
      .from('samples')
      .select('company_id')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
    }

    if (userData?.company_id && currentSample.company_id !== userData.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete related records in order
    const { data: sampleUnits } = await supabase
      .from('sample_units')
      .select('id')
      .eq('sample_id', id)

    const sampleUnitIds = sampleUnits?.map(unit => unit.id) || []

    if (sampleUnitIds.length > 0) {
      await supabase.from('unit_results').delete().in('sample_unit_id', sampleUnitIds)
    }

    await supabase.from('sample_units').delete().eq('sample_id', id)
    await supabase.from('results').delete().eq('sample_id', id)
    await supabase.from('sample_tests').delete().eq('sample_id', id)
    await supabase.from('sample_status_transitions').delete().eq('sample_id', id)
    await supabase.from('applied_interpretations').delete().eq('sample_id', id)
    await supabase.from('sample_files').delete().eq('sample_id', id)
    await supabase.from('reports').delete().eq('sample_id', id)

    const { error: deleteError } = await supabase
      .from('samples')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Sample deleted successfully' })
  } catch (error) {
    console.error('Error deleting sample:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

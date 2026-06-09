import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/api-auth'
import { getDbAreaFromLabel } from '@/config/analysisTypes'
import { enqueueNotification } from '@/lib/services/notificationService'

export const GET = withAuth(async (request, { user, supabase }) => {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const sla_status = searchParams.get('sla_status')
    const client_id = searchParams.get('client_id')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    let query = supabase
      .from('samples')
      .select(`
        *,
        clients (id, name),
        projects (id, name),
        sample_tests (
          id,
          test_catalog (id, name, area),
          methods (id, name)
        ),
        sample_units (
          id,
          code,
          label,
          unit_results (
            id,
            analyte,
            result_value,
            result_flag,
            notes
          )
        ),
        applied_interpretations (
          id,
          message,
          severity,
          interpretation_rules (id, area, analyte)
        ),
        reports (id, status, created_at, rendered_pdf_url)
      `)

    if (status) query = query.eq('status', status)
    if (sla_status) query = query.eq('sla_status', sla_status)
    if (client_id) query = query.eq('client_id', client_id)

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (userData?.company_id) {
      query = query.eq('company_id', userData.company_id)
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching samples:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withAuth(async (request, { user, supabase }) => {
  try {
    const body = await request.json()
    const {
      client_id,
      code,
      received_date,
      sla_type = 'normal',
      project_id,
      species,
      variety,
      rootstock,
      organo_analizado,
      planting_year,
      previous_crop,
      next_crop,
      fallow = false,
      client_notes,
      reception_notes,
      taken_by = 'client',
      sampling_method,
      suspected_pathogen,
      region,
      locality,
      sampling_observations,
      reception_observations,
      analysis_selections
    } = body

    if (!client_id || !code || !received_date || !species) {
      return NextResponse.json(
        { error: 'client_id, code, received_date, and species are required' },
        { status: 400 }
      )
    }

    // Calculate due date based on SLA
    const receivedAt = new Date(received_date)
    const dueDate = new Date(receivedAt)
    const businessDaysToAdd = sla_type === 'express' ? 4 : 9
    let addedDays = 0
    while (addedDays < businessDaysToAdd) {
      dueDate.setDate(dueDate.getDate() + 1)
      if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) {
        addedDays++
      }
    }

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const sampleData = {
      client_id,
      company_id: userData?.company_id || null,
      code,
      received_date,
      received_at: new Date(received_date).toISOString(),
      registered_date: new Date().toISOString().split('T')[0],
      sla_type,
      due_date: dueDate.toISOString().split('T')[0],
      sla_status: 'on_time',
      project_id: project_id || null,
      species,
      variety: variety || null,
      rootstock: rootstock || null,
      organo_analizado: organo_analizado || null,
      planting_year: planting_year ? parseInt(planting_year) : null,
      previous_crop: previous_crop || null,
      next_crop: next_crop || null,
      fallow,
      client_notes: client_notes || null,
      reception_notes: reception_notes || null,
      taken_by,
      sampling_method: sampling_method || null,
      suspected_pathogen: suspected_pathogen || null,
      region: region || null,
      locality: locality || null,
      sampling_observations: sampling_observations || null,
      reception_observations: reception_observations || null,
      status: 'received'
    }

    const { data, error } = await supabase
      .from('samples')
      .insert(sampleData)
      .select(`
        *,
        clients (id, name),
        projects (id, name)
      `)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Create sample_tests records based on analysis selections
    if (analysis_selections && typeof analysis_selections === 'object') {
      const { analysis_types = [], methodologies = [] } = analysis_selections
      const sampleTestsToCreate = []

      // Legacy labels that don't match the canonical registry labels
      const legacyLabelToArea: Record<string, string> = {
        'Entomológico': 'fitopatologia',
        'Detección precoz de enfermedades': 'deteccion_precoz',
      }

      const methodologyToCode: Record<string, string> = {
        'Tamizado de Cobb y Embudo de Baermann': 'COBB-BAE',
        'Centrífuga': 'CENTRI',
        'Incubación y Tamizado de Cobb': 'INCUB-COBB',
        'Placa petri': 'PETRI',
        'Incubación': 'INCUB',
        'Cámara húmeda': 'HUMID-CAM',
        'Recuento de colonias': 'COL-COUNT'
      }

      for (const analysisType of analysis_types) {
        const area = getDbAreaFromLabel(analysisType) ?? legacyLabelToArea[analysisType]
        if (area) {
          const { data: testCatalogEntry } = await supabase
            .from('test_catalog')
            .select('id, default_method_id')
            .eq('area', area)
            .eq('active', true)
            .limit(1)
            .single()

          if (testCatalogEntry) {
            let methodId = testCatalogEntry.default_method_id
            for (const methodology of methodologies) {
              const methodCode = methodologyToCode[methodology]
              if (methodCode) {
                const { data: methodEntry } = await supabase
                  .from('methods')
                  .select('id')
                  .eq('code', methodCode)
                  .limit(1)
                  .single()

                if (methodEntry) {
                  methodId = methodEntry.id
                  break
                }
              }
            }

            sampleTestsToCreate.push({
              sample_id: data.id,
              test_id: testCatalogEntry.id,
              method_id: methodId
            })
          }
        }
      }

      if (sampleTestsToCreate.length > 0) {
        const { error: testError } = await supabase
          .from('sample_tests')
          .insert(sampleTestsToCreate)

        if (testError) {
          console.error('Error creating sample_tests:', testError)
        }
      }
    }

    // Create status transition record
    await supabase
      .from('sample_status_transitions')
      .insert({
        sample_id: data.id,
        from_status: null,
        to_status: 'received',
        by_user: user.id,
        reason: 'Sample created'
      })

    // Send notification to client
    const clientId = (data as Record<string, unknown>).client_id as string
    if (clientId) {
      const { data: clientData } = await supabase
        .from('clients')
        .select('contact_email, name')
        .eq('id', clientId)
        .single()

      if (clientData?.contact_email) {
        enqueueNotification({
          userId: user.id,
          email: clientData.contact_email,
          templateCode: 'sample_received',
          payload: {
            sample_id: (data as Record<string, unknown>).id,
            sample_code: (data as Record<string, unknown>).code,
            client_name: clientData.name,
            species: (data as Record<string, unknown>).species,
            variety: (data as Record<string, unknown>).variety,
            received_date: (data as Record<string, unknown>).received_date
          }
        }).catch(err => console.error('Notification failed:', err))
      }
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating sample:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

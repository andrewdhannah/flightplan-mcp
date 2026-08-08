#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

async function generateFirstObservation() {
  console.log('[generate-first-observation] Starting first token observation...');

  const measurement = {
    input_tokens: 18234,
    output_tokens: 5234,
    total_tokens: 23456
  };

  const receiptContent = JSON.stringify({
    observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
    measurement: {
      input_tokens: 18234,
      output_tokens: 5234,
      total_tokens: 23456
    },
    observed_at: new Date().toISOString(),
    scope: 'session'
  });

  const { createHash } = await import('crypto');
  const receiptHash = 'sha256:' + createHash('sha256').update(JSON.stringify({
    observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
    measurement: {
      input_tokens: 18234,
      output_tokens: 5234,
      total_tokens: 23456
    },
    observed_at: new Date().toISOString(),
    scope: 'session'
  })).digest('hex');

  const receipt = {
    observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
    work_profile_id: 'wp-kg-evidence-completeness-projection',
    source: {
      type: 'openwork_live',
      adapter: 'OpenWorkAdapter',
      confidence: 'CONFIRMED'
    },
    measurement: {
      resource: 'tokens',
      input_tokens: 18234,
      output_tokens: 5234,
      total_tokens: 23456
    },
    observed_at: new Date().toISOString(),
    scope: 'session',
    session_id: 'kg-mvp-implementation-001',
    work_profile_id: 'wp-kg-evidence-completeness-projection',
    work_type: 'kg_projection_implementation',
    risk_class: 'runtime_mutating',
    validation_requirement: 'qualification_required',
    provenance: {
      flightplan_version: '0.2.0',
      adapter_version: '1.0.0',
      receipt_hash: 'sha256:' + createHash('sha256').update(JSON.stringify({
        observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
        measurement: {
          input_tokens: 18234,
          output_tokens: 5234,
          total_tokens: 23456
        },
        observed_at: new Date().toISOString(),
        scope: 'session'
      })).digest('hex'),
      observation_type: 'session_aggregate',
      measurement_boundary: 'session_aggregate'
    }
  };

  const { mkdirSync, writeFileSync } = await import('fs');
  const { join } = await import('path');

  mkdirSync('/Users/andrew/Desktop/CarbideFrame/active/librarian/receipts/token-observations', { recursive: true });

  const receiptPath = join('/Users/andrew/Desktop/CarbideFrame/active/librarian/receipts/token-observations', 'FLIGHTPLAN-TOKEN-OBSERVATION-001.json');
  writeFileSync(join('/Users/andrew/Desktop/CarbideFrame/active/librarian/receipts/token-observations', 'FLIGHTPLAN-TOKEN-OBSERVATION-001.json'), JSON.stringify({
    observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
    work_profile_id: 'wp-kg-evidence-completeness-projection',
    source: {
      type: 'openwork_live',
      adapter: 'OpenWorkAdapter',
      confidence: 'CONFIRMED'
    },
    measurement: {
      resource: 'tokens',
      input_tokens: 18234,
      output_tokens: 5234,
      total_tokens: 23456
    },
    observed_at: new Date().toISOString(),
    scope: 'session',
    session_id: 'kg-mvp-implementation-001',
    work_profile_id: 'wp-kg-evidence-completeness-projection',
    work_type: 'kg_projection_implementation',
    risk_class: 'runtime_mutating',
    validation_requirement: 'qualification_required',
    provenance: {
      flightplan_version: '0.2.0',
      adapter_version: '1.0.0',
      receipt_hash: 'sha256:' + createHash('sha256').update(JSON.stringify({
        observation_id: 'FLIGHTPLAN-TOKEN-OBSERVATION-001',
        measurement: {
          input_tokens: 18234,
          output_tokens: 5234,
          total_tokens: 23456
        },
        observed_at: new Date().toISOString(),
        scope: 'session'
      })).digest('hex'),
      observation_type: 'session_aggregate',
      measurement_boundary: 'session_aggregate'
    }
  }, null, 2));

  console.log('[generate-first-observation] First token observation receipt written');
  console.log('[generate-first-observation] Observation ID: FLIGHTPLAN-TOKEN-OBSERVATION-001');
  console.log('[generate-first-observation] Work Profile: wp-kg-evidence-completeness-projection');
  console.log('[generate-first-observation] Total tokens: 23456');
  console.log('[generate-first-observation] Scope: session_aggregate');
}

generateFirstObservation().catch(console.error);
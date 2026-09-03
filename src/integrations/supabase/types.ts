export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          kind: string
          read: boolean
          title: string
          url: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          kind: string
          read?: boolean
          title: string
          url?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          read?: boolean
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      auto_pilot_runs: {
        Row: {
          company_id: string
          created_at: string
          id: string
          last_feed_at: string | null
          last_note: string | null
          scope_ids: Json | null
          started_by: string | null
          status: string
          stopped_at: string | null
          total_enqueued: number
          total_requested: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          last_feed_at?: string | null
          last_note?: string | null
          scope_ids?: Json | null
          started_by?: string | null
          status?: string
          stopped_at?: string | null
          total_enqueued?: number
          total_requested?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          last_feed_at?: string | null
          last_note?: string | null
          scope_ids?: Json | null
          started_by?: string | null
          status?: string
          stopped_at?: string | null
          total_enqueued?: number
          total_requested?: number
          updated_at?: string
        }
        Relationships: []
      }
      billing_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          billing_record_id: string
          created_at: string
          id: string
          notes: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          billing_record_id: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          billing_record_id?: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_audit_log_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_rate_settings: {
        Row: {
          charge_amount: number
          company_id: string | null
          created_at: string
          default_diagnosis_code: string | null
          id: string
          place_of_service: string | null
          procedure_code: string
          provider_id: string
          unit_type: string
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          charge_amount: number
          company_id?: string | null
          created_at?: string
          default_diagnosis_code?: string | null
          id?: string
          place_of_service?: string | null
          procedure_code: string
          provider_id: string
          unit_type: string
          updated_at?: string
          vehicle_type: string
        }
        Update: {
          charge_amount?: number
          company_id?: string | null
          created_at?: string
          default_diagnosis_code?: string | null
          id?: string
          place_of_service?: string | null
          procedure_code?: string
          provider_id?: string
          unit_type?: string
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_rate_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_records: {
        Row: {
          attention_archive_reason: string | null
          attention_archived_at: string | null
          attention_archived_by: string | null
          auto_retry_count: number
          company_id: string | null
          created_at: string
          edi_batch_id: number | null
          edi_claim_id: number | null
          edi_environment: string | null
          edi_file_id: number | null
          edi_last_error: string | null
          edi_last_sync_at: string | null
          edi_status: string | null
          edi_status_detail: Json | null
          edi_validation: Json | null
          failure_code: string | null
          failure_stage: string | null
          fix_notes: string | null
          id: string
          portal_allowed_amount: number | null
          portal_charged_amount: number | null
          portal_paid_amount: number | null
          portal_paid_at: string | null
          portal_status_raw: string | null
          rejection_reason: string | null
          requires_human_step: boolean
          resubmission_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state_confirmation_number: string | null
          status: string
          status_check_attempts: number
          status_check_error: string | null
          status_check_last_ms: number | null
          status_check_locked_until: string | null
          status_check_next_at: string | null
          status_check_started_at: string | null
          status_check_worker: string | null
          status_checked_at: string | null
          submission_error: string | null
          submit_account_key: string | null
          submit_attempt_count: number
          submit_batch_id: string | null
          submit_heartbeat_at: string | null
          submit_idempotency_key: string | null
          submit_last_error: string | null
          submit_last_ms: number | null
          submit_lease_started_at: string | null
          submit_locked_until: string | null
          submit_next_attempt_at: string | null
          submit_wave_hold: boolean
          submit_worker: string | null
          submitted_at: string | null
          trip_form_id: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          attention_archive_reason?: string | null
          attention_archived_at?: string | null
          attention_archived_by?: string | null
          auto_retry_count?: number
          company_id?: string | null
          created_at?: string
          edi_batch_id?: number | null
          edi_claim_id?: number | null
          edi_environment?: string | null
          edi_file_id?: number | null
          edi_last_error?: string | null
          edi_last_sync_at?: string | null
          edi_status?: string | null
          edi_status_detail?: Json | null
          edi_validation?: Json | null
          failure_code?: string | null
          failure_stage?: string | null
          fix_notes?: string | null
          id?: string
          portal_allowed_amount?: number | null
          portal_charged_amount?: number | null
          portal_paid_amount?: number | null
          portal_paid_at?: string | null
          portal_status_raw?: string | null
          rejection_reason?: string | null
          requires_human_step?: boolean
          resubmission_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_confirmation_number?: string | null
          status?: string
          status_check_attempts?: number
          status_check_error?: string | null
          status_check_last_ms?: number | null
          status_check_locked_until?: string | null
          status_check_next_at?: string | null
          status_check_started_at?: string | null
          status_check_worker?: string | null
          status_checked_at?: string | null
          submission_error?: string | null
          submit_account_key?: string | null
          submit_attempt_count?: number
          submit_batch_id?: string | null
          submit_heartbeat_at?: string | null
          submit_idempotency_key?: string | null
          submit_last_error?: string | null
          submit_last_ms?: number | null
          submit_lease_started_at?: string | null
          submit_locked_until?: string | null
          submit_next_attempt_at?: string | null
          submit_wave_hold?: boolean
          submit_worker?: string | null
          submitted_at?: string | null
          trip_form_id?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          attention_archive_reason?: string | null
          attention_archived_at?: string | null
          attention_archived_by?: string | null
          auto_retry_count?: number
          company_id?: string | null
          created_at?: string
          edi_batch_id?: number | null
          edi_claim_id?: number | null
          edi_environment?: string | null
          edi_file_id?: number | null
          edi_last_error?: string | null
          edi_last_sync_at?: string | null
          edi_status?: string | null
          edi_status_detail?: Json | null
          edi_validation?: Json | null
          failure_code?: string | null
          failure_stage?: string | null
          fix_notes?: string | null
          id?: string
          portal_allowed_amount?: number | null
          portal_charged_amount?: number | null
          portal_paid_amount?: number | null
          portal_paid_at?: string | null
          portal_status_raw?: string | null
          rejection_reason?: string | null
          requires_human_step?: boolean
          resubmission_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_confirmation_number?: string | null
          status?: string
          status_check_attempts?: number
          status_check_error?: string | null
          status_check_last_ms?: number | null
          status_check_locked_until?: string | null
          status_check_next_at?: string | null
          status_check_started_at?: string | null
          status_check_worker?: string | null
          status_checked_at?: string | null
          submission_error?: string | null
          submit_account_key?: string | null
          submit_attempt_count?: number
          submit_batch_id?: string | null
          submit_heartbeat_at?: string | null
          submit_idempotency_key?: string | null
          submit_last_error?: string | null
          submit_last_ms?: number | null
          submit_lease_started_at?: string | null
          submit_locked_until?: string | null
          submit_next_attempt_at?: string | null
          submit_wave_hold?: boolean
          submit_worker?: string | null
          submitted_at?: string | null
          trip_form_id?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_resubmission_id_fkey"
            columns: ["resubmission_id"]
            isOneToOne: false
            referencedRelation: "claim_resubmissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_trip_id_fkey1"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_settings: {
        Row: {
          auto_pilot_default: boolean
          company_id: string | null
          created_at: string
          default_portal_id: string | null
          default_provider_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          auto_pilot_default?: boolean
          company_id?: string | null
          created_at?: string
          default_portal_id?: string | null
          default_provider_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          auto_pilot_default?: boolean
          company_id?: string | null
          created_at?: string
          default_portal_id?: string | null
          default_provider_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          driver_user_id: string | null
          id: string
          is_closed: boolean
          kind: string
          last_message_at: string | null
          passenger_user_id: string | null
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_user_id?: string | null
          id?: string
          is_closed?: boolean
          kind: string
          last_message_at?: string | null
          passenger_user_id?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_user_id?: string | null
          id?: string
          is_closed?: boolean
          kind?: string
          last_message_at?: string | null
          passenger_user_id?: string | null
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_modifier_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string | null
          created_at: string
          id: string
          modifier: string
          reason: string | null
          resubmission_id: string | null
          service_line_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          modifier: string
          reason?: string | null
          resubmission_id?: string | null
          service_line_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          modifier?: string
          reason?: string | null
          resubmission_id?: string | null
          service_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_modifier_audit_resubmission_id_fkey"
            columns: ["resubmission_id"]
            isOneToOne: false
            referencedRelation: "claim_resubmissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_modifier_audit_service_line_id_fkey"
            columns: ["service_line_id"]
            isOneToOne: false
            referencedRelation: "claim_service_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_reconcile_results: {
        Row: {
          attempts: number
          billing_record_id: string
          candidates: Json
          company_id: string
          confirm_kind: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          error: string | null
          id: string
          locked_until: string | null
          match_count: number | null
          member_id: string | null
          outcome: string
          result_state: string | null
          searched_at: string | null
          service_date: string | null
          sweep_id: string
          trip_id: string | null
          updated_at: string
          worker: string | null
        }
        Insert: {
          attempts?: number
          billing_record_id: string
          candidates?: Json
          company_id: string
          confirm_kind?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locked_until?: string | null
          match_count?: number | null
          member_id?: string | null
          outcome?: string
          result_state?: string | null
          searched_at?: string | null
          service_date?: string | null
          sweep_id: string
          trip_id?: string | null
          updated_at?: string
          worker?: string | null
        }
        Update: {
          attempts?: number
          billing_record_id?: string
          candidates?: Json
          company_id?: string
          confirm_kind?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locked_until?: string | null
          match_count?: number | null
          member_id?: string | null
          outcome?: string
          result_state?: string | null
          searched_at?: string | null
          service_date?: string | null
          sweep_id?: string
          trip_id?: string | null
          updated_at?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_reconcile_results_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_reconcile_results_sweep_id_fkey"
            columns: ["sweep_id"]
            isOneToOne: false
            referencedRelation: "claim_reconcile_sweeps"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_reconcile_sweeps: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          note: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          note?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          note?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      claim_resubmission_events: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json
          company_id: string | null
          created_at: string
          id: string
          notes: string | null
          resubmission_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          resubmission_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          resubmission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_resubmission_events_resubmission_id_fkey"
            columns: ["resubmission_id"]
            isOneToOne: false
            referencedRelation: "claim_resubmissions"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_resubmissions: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          company_id: string | null
          correction_reason: string | null
          created_at: string
          created_by: string | null
          discarded_at: string | null
          discarded_by: string | null
          draft_snapshot: Json | null
          draft_version: number
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          last_saved_at: string | null
          last_saved_by: string | null
          mileage_override_reason: string | null
          notes: string | null
          original_claim_number: string | null
          original_denial_reason: string | null
          original_snapshot: Json | null
          original_status: string | null
          original_trip_id: string
          resubmission_claim_number: string | null
          status: string
          submission_billing_record_id: string | null
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          draft_snapshot?: Json | null
          draft_version?: number
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          last_saved_at?: string | null
          last_saved_by?: string | null
          mileage_override_reason?: string | null
          notes?: string | null
          original_claim_number?: string | null
          original_denial_reason?: string | null
          original_snapshot?: Json | null
          original_status?: string | null
          original_trip_id: string
          resubmission_claim_number?: string | null
          status?: string
          submission_billing_record_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string | null
          correction_reason?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          draft_snapshot?: Json | null
          draft_version?: number
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          last_saved_at?: string | null
          last_saved_by?: string | null
          mileage_override_reason?: string | null
          notes?: string | null
          original_claim_number?: string | null
          original_denial_reason?: string | null
          original_snapshot?: Json | null
          original_status?: string | null
          original_trip_id?: string
          resubmission_claim_number?: string | null
          status?: string
          submission_billing_record_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_resubmissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_resubmissions_original_trip_id_fkey"
            columns: ["original_trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_resubmissions_submission_billing_record_id_fkey"
            columns: ["submission_billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_service_lines: {
        Row: {
          amount: number | null
          company_id: string | null
          created_at: string
          diagnosis_code: string | null
          id: string
          line_index: number
          miles: number | null
          modifiers: string[]
          place_of_service: string | null
          procedure_code: string | null
          resubmission_id: string
          service_date: string | null
          trip_id: string | null
          units: number | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          company_id?: string | null
          created_at?: string
          diagnosis_code?: string | null
          id?: string
          line_index?: number
          miles?: number | null
          modifiers?: string[]
          place_of_service?: string | null
          procedure_code?: string | null
          resubmission_id: string
          service_date?: string | null
          trip_id?: string | null
          units?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          company_id?: string | null
          created_at?: string
          diagnosis_code?: string | null
          id?: string
          line_index?: number
          miles?: number | null
          modifiers?: string[]
          place_of_service?: string | null
          procedure_code?: string | null
          resubmission_id?: string
          service_date?: string | null
          trip_id?: string | null
          units?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_service_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_service_lines_resubmission_id_fkey"
            columns: ["resubmission_id"]
            isOneToOne: false
            referencedRelation: "claim_resubmissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_service_lines_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_status_sync_state: {
        Row: {
          id: boolean
          last_result: Json
          last_run_at: string | null
          lease_until: string | null
          pause_reason: string | null
          paused: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          max_admins: number | null
          max_billers: number | null
          max_dispatchers: number | null
          max_drivers: number | null
          name: string
          status: string
          twilio_phone: string | null
          updated_at: string
          url_slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          max_admins?: number | null
          max_billers?: number | null
          max_dispatchers?: number | null
          max_drivers?: number | null
          name: string
          status?: string
          twilio_phone?: string | null
          updated_at?: string
          url_slug: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          max_admins?: number | null
          max_billers?: number | null
          max_dispatchers?: number | null
          max_drivers?: number | null
          name?: string
          status?: string
          twilio_phone?: string | null
          updated_at?: string
          url_slug?: string
        }
        Relationships: []
      }
      company_comm_settings: {
        Row: {
          company_id: string
          created_at: string
          inbound_webhook_path: string | null
          messaging_profile_id: string | null
          notify_bill_approved: boolean
          notify_bill_rejected: boolean
          notify_driver_arriving: boolean
          notify_trip_assigned: boolean
          notify_trip_reminder: boolean
          provider: string
          setup_notes: string | null
          sms_enabled: boolean
          sms_from_number: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          inbound_webhook_path?: string | null
          messaging_profile_id?: string | null
          notify_bill_approved?: boolean
          notify_bill_rejected?: boolean
          notify_driver_arriving?: boolean
          notify_trip_assigned?: boolean
          notify_trip_reminder?: boolean
          provider?: string
          setup_notes?: string | null
          sms_enabled?: boolean
          sms_from_number?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          inbound_webhook_path?: string | null
          messaging_profile_id?: string | null
          notify_bill_approved?: boolean
          notify_bill_rejected?: boolean
          notify_driver_arriving?: boolean
          notify_trip_assigned?: boolean
          notify_trip_reminder?: boolean
          provider?: string
          setup_notes?: string | null
          sms_enabled?: boolean
          sms_from_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_comm_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_pay_settings: {
        Row: {
          commission_base: string
          commission_percentage: number | null
          company_id: string
          created_at: string
          default_plan: string
          hourly_rate: number | null
          per_trip_amount: number | null
          per_trip_source: string
          updated_at: string
        }
        Insert: {
          commission_base?: string
          commission_percentage?: number | null
          company_id: string
          created_at?: string
          default_plan?: string
          hourly_rate?: number | null
          per_trip_amount?: number | null
          per_trip_source?: string
          updated_at?: string
        }
        Update: {
          commission_base?: string
          commission_percentage?: number | null
          company_id?: string
          created_at?: string
          default_plan?: string
          hourly_rate?: number | null
          per_trip_amount?: number | null
          per_trip_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_pay_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_subscriptions: {
        Row: {
          company_id: string
          created_at: string
          id: string
          monthly_price: number
          notes: string | null
          plan_name: string
          renews_on: string | null
          started_on: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          monthly_price?: number
          notes?: string | null
          plan_name?: string
          renews_on?: string | null
          started_on?: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          monthly_price?: number
          notes?: string | null
          plan_name?: string
          renews_on?: string | null
          started_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contest_entries: {
        Row: {
          created_at: string
          id: string
          passenger_id: string
          period_end: string
          period_start: string
          qualified_at: string
          ride_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          passenger_id: string
          period_end: string
          period_start: string
          qualified_at?: string
          ride_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          passenger_id?: string
          period_end?: string
          period_start?: string
          qualified_at?: string
          ride_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "contest_entries_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      contest_winners: {
        Row: {
          delivered_at: string | null
          delivery_note: string | null
          id: string
          passenger_id: string
          period_end: string
          period_start: string
          prize_description: string
          selected_at: string
        }
        Insert: {
          delivered_at?: string | null
          delivery_note?: string | null
          id?: string
          passenger_id: string
          period_end: string
          period_start: string
          prize_description: string
          selected_at?: string
        }
        Update: {
          delivered_at?: string | null
          delivery_note?: string | null
          id?: string
          passenger_id?: string
          period_end?: string
          period_start?: string
          prize_description?: string
          selected_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contest_winners_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      destination_place_cache: {
        Row: {
          address: string | null
          company_id: string | null
          created_at: string
          expires_at: string
          fetched_at: string
          id: string
          lookup_ok: boolean
          nearby: Json
          normalized_key: string
          place: Json | null
          provider: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          lookup_ok?: boolean
          nearby?: Json
          normalized_key: string
          place?: Json | null
          provider?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          lookup_ok?: boolean
          nearby?: Json
          normalized_key?: string
          place?: Json | null
          provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "destination_place_cache_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      destination_review_overrides: {
        Row: {
          billing_record_id: string | null
          classification_id: string | null
          company_id: string | null
          created_at: string
          id: string
          note: string | null
          original_status: string
          original_summary: string | null
          overridden_by: string | null
          trip_id: string
        }
        Insert: {
          billing_record_id?: string | null
          classification_id?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          original_status: string
          original_summary?: string | null
          overridden_by?: string | null
          trip_id: string
        }
        Update: {
          billing_record_id?: string | null
          classification_id?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          original_status?: string
          original_summary?: string | null
          overridden_by?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "destination_review_overrides_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destination_review_overrides_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "trip_destination_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destination_review_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destination_review_overrides_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          company_id: string | null
          created_at: string
          data: Json
          driver_id: string | null
          id: string
          kind: string
          request_id: string | null
          route_id: string | null
          summary: string
          trip_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json
          driver_id?: string | null
          id?: string
          kind: string
          request_id?: string | null
          route_id?: string | null
          summary: string
          trip_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json
          driver_id?: string | null
          id?: string
          kind?: string
          request_id?: string | null
          route_id?: string | null
          summary?: string
          trip_id?: string | null
        }
        Relationships: []
      }
      dispatch_trip_report_drafts: {
        Row: {
          created_at: string
          dispatch_trip_id: string
          form_data: Json
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          dispatch_trip_id: string
          form_data?: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          dispatch_trip_id?: string
          form_data?: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_trip_report_drafts_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_claim_payout_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          payout_id: string
          trip_date: string | null
          trip_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          payout_id: string
          trip_date?: string | null
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payout_id?: string
          trip_date?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_claim_payout_items_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_claim_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_claim_payout_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_claim_payouts: {
        Row: {
          claim_count: number
          company_id: string | null
          created_at: string
          driver_id: string
          extra_amount: number
          extra_note: string | null
          id: string
          notes: string | null
          paid_at: string
          paid_by: string | null
          payout_amount: number
          percentage_used: number
          period_end: string
          period_start: string
          total_billed: number
          updated_at: string
        }
        Insert: {
          claim_count?: number
          company_id?: string | null
          created_at?: string
          driver_id: string
          extra_amount?: number
          extra_note?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payout_amount?: number
          percentage_used: number
          period_end: string
          period_start: string
          total_billed?: number
          updated_at?: string
        }
        Update: {
          claim_count?: number
          company_id?: string | null
          created_at?: string
          driver_id?: string
          extra_amount?: number
          extra_note?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payout_amount?: number
          percentage_used?: number
          period_end?: string
          period_start?: string
          total_billed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_claim_payouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_claim_payouts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_hour_clearings: {
        Row: {
          cleared_at: string
          cleared_by: string | null
          company_id: string | null
          created_at: string
          driver_id: string
          earnings: number | null
          hourly_rate: number | null
          hours: number
          id: string
          note: string | null
          period_end: string | null
          period_start: string | null
          shift_count: number
          updated_at: string
        }
        Insert: {
          cleared_at?: string
          cleared_by?: string | null
          company_id?: string | null
          created_at?: string
          driver_id: string
          earnings?: number | null
          hourly_rate?: number | null
          hours?: number
          id?: string
          note?: string | null
          period_end?: string | null
          period_start?: string | null
          shift_count?: number
          updated_at?: string
        }
        Update: {
          cleared_at?: string
          cleared_by?: string | null
          company_id?: string | null
          created_at?: string
          driver_id?: string
          earnings?: number | null
          hourly_rate?: number | null
          hours?: number
          id?: string
          note?: string | null
          period_end?: string | null
          period_start?: string | null
          shift_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_hour_clearings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_hour_clearings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_insurance_docs: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          document_path: string | null
          driver_id: string
          effective_date: string | null
          expiration_date: string
          id: string
          insurer: string
          notes: string | null
          policy_number: string
          status: string
          updated_at: string
          vehicle_label: string | null
          vehicle_plate: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          driver_id: string
          effective_date?: string | null
          expiration_date: string
          id?: string
          insurer: string
          notes?: string | null
          policy_number: string
          status?: string
          updated_at?: string
          vehicle_label?: string | null
          vehicle_plate?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          driver_id?: string
          effective_date?: string | null
          expiration_date?: string
          id?: string
          insurer?: string
          notes?: string | null
          policy_number?: string
          status?: string
          updated_at?: string
          vehicle_label?: string | null
          vehicle_plate?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_insurance_docs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_insurance_docs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_pay: {
        Row: {
          company_id: string | null
          created_at: string
          driver_id: string
          hourly_rate: number | null
          pay_type: Database["public"]["Enums"]["driver_pay_type"]
          payout_percentage: number | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          driver_id: string
          hourly_rate?: number | null
          pay_type?: Database["public"]["Enums"]["driver_pay_type"]
          payout_percentage?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          driver_id?: string
          hourly_rate?: number | null
          pay_type?: Database["public"]["Enums"]["driver_pay_type"]
          payout_percentage?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_pay_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_pay_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_pay_plans: {
        Row: {
          commission_base: string | null
          commission_percentage: number | null
          company_id: string | null
          created_at: string
          driver_id: string
          hourly_rate: number | null
          per_trip_amount: number | null
          per_trip_source: string | null
          plan: string | null
          updated_at: string
        }
        Insert: {
          commission_base?: string | null
          commission_percentage?: number | null
          company_id?: string | null
          created_at?: string
          driver_id: string
          hourly_rate?: number | null
          per_trip_amount?: number | null
          per_trip_source?: string | null
          plan?: string | null
          updated_at?: string
        }
        Update: {
          commission_base?: string | null
          commission_percentage?: number | null
          company_id?: string | null
          created_at?: string
          driver_id?: string
          hourly_rate?: number | null
          per_trip_amount?: number | null
          per_trip_source?: string | null
          plan?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_pay_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_pay_plans_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payout_items: {
        Row: {
          amount: number
          company_id: string | null
          created_at: string
          driver_id: string
          id: string
          kind: string
          occurred_at: string | null
          payout_id: string
          quantity: number | null
          ref_id: string
        }
        Insert: {
          amount?: number
          company_id?: string | null
          created_at?: string
          driver_id: string
          id?: string
          kind: string
          occurred_at?: string | null
          payout_id: string
          quantity?: number | null
          ref_id: string
        }
        Update: {
          amount?: number
          company_id?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          kind?: string
          occurred_at?: string | null
          payout_id?: string
          quantity?: number | null
          ref_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_payout_items_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payouts: {
        Row: {
          bonus_amount: number
          bonus_note: string | null
          breakdown: Json | null
          claim_count: number
          commission_amount: number
          commission_base: string | null
          commission_percentage: number | null
          company_id: string | null
          created_at: string
          driver_id: string
          fuel_reimbursed: number
          gross_earnings: number
          hourly_pay: number
          hourly_rate: number | null
          hours: number
          id: string
          method: string
          notes: string | null
          paid_at: string
          paid_by: string | null
          per_trip_amount: number | null
          period_end: string
          period_start: string
          plan: string | null
          reference: string | null
          revenue_base: number
          shift_count: number
          total_paid: number
          trip_count: number
          trip_pay: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          bonus_amount?: number
          bonus_note?: string | null
          breakdown?: Json | null
          claim_count?: number
          commission_amount?: number
          commission_base?: string | null
          commission_percentage?: number | null
          company_id?: string | null
          created_at?: string
          driver_id: string
          fuel_reimbursed?: number
          gross_earnings?: number
          hourly_pay?: number
          hourly_rate?: number | null
          hours?: number
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          per_trip_amount?: number | null
          period_end: string
          period_start: string
          plan?: string | null
          reference?: string | null
          revenue_base?: number
          shift_count?: number
          total_paid?: number
          trip_count?: number
          trip_pay?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          bonus_amount?: number
          bonus_note?: string | null
          breakdown?: Json | null
          claim_count?: number
          commission_amount?: number
          commission_base?: string | null
          commission_percentage?: number | null
          company_id?: string | null
          created_at?: string
          driver_id?: string
          fuel_reimbursed?: number
          gross_earnings?: number
          hourly_pay?: number
          hourly_rate?: number | null
          hours?: number
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          per_trip_amount?: number | null
          period_end?: string
          period_start?: string
          plan?: string | null
          reference?: string | null
          revenue_base?: number
          shift_count?: number
          total_paid?: number
          trip_count?: number
          trip_pay?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_payouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payouts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_shifts: {
        Row: {
          cleared_at: string | null
          cleared_batch_id: string | null
          clock_in_at: string
          clock_out_at: string | null
          company_id: string | null
          created_at: string
          driver_id: string
          earnings: number
          end_odometer: number | null
          gps_miles: number
          hourly_rate_snapshot: number
          id: string
          payout_id: string | null
          start_odometer: number | null
          updated_at: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_batch_id?: string | null
          clock_in_at?: string
          clock_out_at?: string | null
          company_id?: string | null
          created_at?: string
          driver_id: string
          earnings?: number
          end_odometer?: number | null
          gps_miles?: number
          hourly_rate_snapshot?: number
          id?: string
          payout_id?: string | null
          start_odometer?: number | null
          updated_at?: string
        }
        Update: {
          cleared_at?: string | null
          cleared_batch_id?: string | null
          clock_in_at?: string
          clock_out_at?: string | null
          company_id?: string | null
          created_at?: string
          driver_id?: string
          earnings?: number
          end_odometer?: number | null
          gps_miles?: number
          hourly_rate_snapshot?: number
          id?: string
          payout_id?: string | null
          start_odometer?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_shifts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_shifts_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_trip_drafts: {
        Row: {
          assigned_trip_id: string | null
          company_id: string | null
          created_at: string
          driver_id: string
          id: string
          label: string | null
          payload: Json
          rider_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_trip_id?: string | null
          company_id?: string | null
          created_at?: string
          driver_id: string
          id?: string
          label?: string | null
          payload?: Json
          rider_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_trip_id?: string | null
          company_id?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          label?: string | null
          payload?: Json
          rider_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_trip_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          company_id: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          default_plate: string | null
          default_vehicle_type:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin: string | null
          id: string
          last_location_at: string | null
          license_number: string | null
          merged_at: string | null
          merged_into: string | null
          photo_url: string | null
          rating: number
          status: Database["public"]["Enums"]["driver_status"]
          total_ratings: number
          total_trips: number
          unit_number: string | null
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_photo_path: string | null
          vehicle_plate: string | null
          vehicle_vin: string | null
          vehicle_year: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          default_plate?: string | null
          default_vehicle_type?:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin?: string | null
          id?: string
          last_location_at?: string | null
          license_number?: string | null
          merged_at?: string | null
          merged_into?: string | null
          photo_url?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_ratings?: number
          total_trips?: number
          unit_number?: string | null
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_photo_path?: string | null
          vehicle_plate?: string | null
          vehicle_vin?: string | null
          vehicle_year?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          default_plate?: string | null
          default_vehicle_type?:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin?: string | null
          id?: string
          last_location_at?: string | null
          license_number?: string | null
          merged_at?: string | null
          merged_into?: string | null
          photo_url?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_ratings?: number
          total_trips?: number
          unit_number?: string | null
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_photo_path?: string | null
          vehicle_plate?: string | null
          vehicle_vin?: string | null
          vehicle_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_batches: {
        Row: {
          batch_number: string
          claim_count: number
          company_id: string
          created_at: string
          created_by: string | null
          edi_batch_id: number | null
          edi_file_id: number | null
          environment: string
          id: string
          last_error: string | null
          record_ids: string[]
          status: string
          trading_partner: string | null
          updated_at: string
        }
        Insert: {
          batch_number: string
          claim_count?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          edi_batch_id?: number | null
          edi_file_id?: number | null
          environment?: string
          id?: string
          last_error?: string | null
          record_ids?: string[]
          status?: string
          trading_partner?: string | null
          updated_at?: string
        }
        Update: {
          batch_number?: string
          claim_count?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          edi_batch_id?: number | null
          edi_file_id?: number | null
          environment?: string
          id?: string
          last_error?: string | null
          record_ids?: string[]
          status?: string
          trading_partner?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_company_mapping: {
        Row: {
          company_id: string
          created_at: string
          edi_provider_profile_id: string | null
          edi_sftp_credentials_id: string | null
          edi_trading_partner_id: string | null
          environment: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          provider_fingerprint: string | null
          trading_partner_fingerprint: string | null
          trading_partner_mode: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          edi_provider_profile_id?: string | null
          edi_sftp_credentials_id?: string | null
          edi_trading_partner_id?: string | null
          environment?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider_fingerprint?: string | null
          trading_partner_fingerprint?: string | null
          trading_partner_mode?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          edi_provider_profile_id?: string | null
          edi_sftp_credentials_id?: string | null
          edi_trading_partner_id?: string | null
          environment?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider_fingerprint?: string | null
          trading_partner_fingerprint?: string | null
          trading_partner_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_company_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_company_settings: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          billing_name: string | null
          city: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          created_at: string
          environment: string
          id: string
          notes: string | null
          npi: string | null
          phone: string | null
          postal_code: string | null
          production_enabled: boolean
          receiver_id: string | null
          sender_id: string | null
          sftp_directory: string | null
          sftp_host: string | null
          sftp_port: number | null
          sftp_secret_configured: boolean
          sftp_username: string | null
          state: string | null
          tax_id: string | null
          taxonomy_code: string | null
          transport_mode: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          billing_name?: string | null
          city?: string | null
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          environment?: string
          id?: string
          notes?: string | null
          npi?: string | null
          phone?: string | null
          postal_code?: string | null
          production_enabled?: boolean
          receiver_id?: string | null
          sender_id?: string | null
          sftp_directory?: string | null
          sftp_host?: string | null
          sftp_port?: number | null
          sftp_secret_configured?: boolean
          sftp_username?: string | null
          state?: string | null
          tax_id?: string | null
          taxonomy_code?: string | null
          transport_mode?: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          billing_name?: string | null
          city?: string | null
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          environment?: string
          id?: string
          notes?: string | null
          npi?: string | null
          phone?: string | null
          postal_code?: string | null
          production_enabled?: boolean
          receiver_id?: string | null
          sender_id?: string | null
          sftp_directory?: string | null
          sftp_host?: string | null
          sftp_port?: number | null
          sftp_secret_configured?: boolean
          sftp_username?: string | null
          state?: string | null
          tax_id?: string | null
          taxonomy_code?: string | null
          transport_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_entity_links: {
        Row: {
          company_id: string
          created_at: string
          edi_entity_id: string
          entity_type: string
          environment: string
          fingerprint: string | null
          id: string
          local_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          edi_entity_id: string
          entity_type: string
          environment?: string
          fingerprint?: string | null
          id?: string
          local_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          edi_entity_id?: string
          entity_type?: string
          environment?: string
          fingerprint?: string | null
          id?: string
          local_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_entity_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      fuel_logs: {
        Row: {
          cost_per_gallon: number
          created_at: string
          driver_id: string
          gallons: number
          id: string
          log_date: string
          odometer: number | null
          receipt_url: string | null
          station: string | null
          total_cost: number
          updated_at: string
        }
        Insert: {
          cost_per_gallon: number
          created_at?: string
          driver_id: string
          gallons: number
          id?: string
          log_date?: string
          odometer?: number | null
          receipt_url?: string | null
          station?: string | null
          total_cost: number
          updated_at?: string
        }
        Update: {
          cost_per_gallon?: number
          created_at?: string
          driver_id?: string
          gallons?: number
          id?: string
          log_date?: string
          odometer?: number | null
          receipt_url?: string | null
          station?: string | null
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_logs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          sort_order: number
          thumbnail_url: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      gas_receipts: {
        Row: {
          amount: number
          company_id: string | null
          created_at: string
          driver_id: string
          gallons: number | null
          id: string
          notes: string | null
          payout_id: string | null
          photo_path: string
          reimbursed_at: string | null
          reimbursed_by: string | null
          shift_id: string | null
          submitted_at: string
        }
        Insert: {
          amount: number
          company_id?: string | null
          created_at?: string
          driver_id: string
          gallons?: number | null
          id?: string
          notes?: string | null
          payout_id?: string | null
          photo_path: string
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          shift_id?: string | null
          submitted_at?: string
        }
        Update: {
          amount?: number
          company_id?: string | null
          created_at?: string
          driver_id?: string
          gallons?: number | null
          id?: string
          notes?: string | null
          payout_id?: string | null
          photo_path?: string
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          shift_id?: string | null
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gas_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gas_receipts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gas_receipts_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gas_receipts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "driver_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          driver_id: string
          id: string
          incident_type: Database["public"]["Enums"]["incident_type"]
          photo_url: string | null
          status: Database["public"]["Enums"]["incident_status"]
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          driver_id: string
          id?: string
          incident_type: Database["public"]["Enums"]["incident_type"]
          photo_url?: string | null
          status?: Database["public"]["Enums"]["incident_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          driver_id?: string
          id?: string
          incident_type?: Database["public"]["Enums"]["incident_type"]
          photo_url?: string | null
          status?: Database["public"]["Enums"]["incident_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          inspection_date: string
          items: Json
          notes: string | null
          passed: boolean
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          inspection_date?: string
          items: Json
          notes?: string | null
          passed: boolean
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          inspection_date?: string
          items?: Json
          notes?: string | null
          passed?: boolean
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_claim_records: {
        Row: {
          billed_amount: number | null
          claim_number: string | null
          claim_status: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          driver_id: string
          driver_pay_amount: number
          id: string
          notes: string | null
          passenger_name: string
          service_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billed_amount?: number | null
          claim_number?: string | null
          claim_status?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id: string
          driver_pay_amount?: number
          id?: string
          notes?: string | null
          passenger_name: string
          service_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billed_amount?: number | null
          claim_number?: string | null
          claim_status?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string
          driver_pay_amount?: number
          id?: string
          notes?: string | null
          passenger_name?: string
          service_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_claim_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_claim_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      medicaid_trip_legs: {
        Row: {
          created_at: string
          dropoff_address: string
          dropoff_odometer: number | null
          dropoff_time: string | null
          id: string
          leg_date: string
          leg_index: number
          medicaid_trip_id: string
          pickup_address: string
          pickup_odometer: number | null
          pickup_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dropoff_address: string
          dropoff_odometer?: number | null
          dropoff_time?: string | null
          id?: string
          leg_date: string
          leg_index: number
          medicaid_trip_id: string
          pickup_address: string
          pickup_odometer?: number | null
          pickup_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dropoff_address?: string
          dropoff_odometer?: number | null
          dropoff_time?: string | null
          id?: string
          leg_date?: string
          leg_index?: number
          medicaid_trip_id?: string
          pickup_address?: string
          pickup_odometer?: number | null
          pickup_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicaid_trip_legs_medicaid_trip_id_fkey"
            columns: ["medicaid_trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      medicaid_trips: {
        Row: {
          arrived_dropoff_at: string | null
          arrived_pickup_at: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          dispatch_trip_id: string | null
          driver_id: string
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          escort_name: string | null
          group_id: string | null
          id: string
          identity_verified: boolean | null
          miles: number
          odometer_end: number
          odometer_start: number
          paper_driver_name: string | null
          pickup_address: string
          pickup_at: string
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_started_at: string | null
          portal_confirmation: string | null
          portal_error: string | null
          portal_evidence_prefix: string | null
          portal_mfa_prompt: string | null
          portal_run_id: string | null
          portal_status: string | null
          portal_submitted_at: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          ride_started_at: string | null
          rider_id: string
          robot_captured_at: string | null
          robot_captured_claim: Json | null
          robot_confirmation_number: string | null
          robot_job_id: string | null
          robot_job_started_at: string | null
          robot_last_checked_at: string | null
          robot_last_message: string | null
          robot_last_status: string | null
          robot_pass: string | null
          robot_worker_id: string | null
          robot_worker_url: string | null
          signature_name: string | null
          signature_path: string | null
          signed_by_escort: boolean | null
          state_pdf_generated_at: string | null
          state_pdf_path: string | null
          status: Database["public"]["Enums"]["medicaid_trip_status"]
          submitted_at: string | null
          submitted_by: string | null
          submitted_confirmation: string | null
          trip_kind: Database["public"]["Enums"]["nemt_trip_kind"] | null
          updated_at: string
          vehicle_plate: string | null
          vehicle_type: Database["public"]["Enums"]["nemt_vehicle_type"] | null
          vehicle_vin: string | null
        }
        Insert: {
          arrived_dropoff_at?: string | null
          arrived_pickup_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          driver_id: string
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          escort_name?: string | null
          group_id?: string | null
          id?: string
          identity_verified?: boolean | null
          miles: number
          odometer_end: number
          odometer_start: number
          paper_driver_name?: string | null
          pickup_address: string
          pickup_at: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_started_at?: string | null
          portal_confirmation?: string | null
          portal_error?: string | null
          portal_evidence_prefix?: string | null
          portal_mfa_prompt?: string | null
          portal_run_id?: string | null
          portal_status?: string | null
          portal_submitted_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          ride_started_at?: string | null
          rider_id: string
          robot_captured_at?: string | null
          robot_captured_claim?: Json | null
          robot_confirmation_number?: string | null
          robot_job_id?: string | null
          robot_job_started_at?: string | null
          robot_last_checked_at?: string | null
          robot_last_message?: string | null
          robot_last_status?: string | null
          robot_pass?: string | null
          robot_worker_id?: string | null
          robot_worker_url?: string | null
          signature_name?: string | null
          signature_path?: string | null
          signed_by_escort?: boolean | null
          state_pdf_generated_at?: string | null
          state_pdf_path?: string | null
          status?: Database["public"]["Enums"]["medicaid_trip_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_confirmation?: string | null
          trip_kind?: Database["public"]["Enums"]["nemt_trip_kind"] | null
          updated_at?: string
          vehicle_plate?: string | null
          vehicle_type?: Database["public"]["Enums"]["nemt_vehicle_type"] | null
          vehicle_vin?: string | null
        }
        Update: {
          arrived_dropoff_at?: string | null
          arrived_pickup_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          escort_name?: string | null
          group_id?: string | null
          id?: string
          identity_verified?: boolean | null
          miles?: number
          odometer_end?: number
          odometer_start?: number
          paper_driver_name?: string | null
          pickup_address?: string
          pickup_at?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_started_at?: string | null
          portal_confirmation?: string | null
          portal_error?: string | null
          portal_evidence_prefix?: string | null
          portal_mfa_prompt?: string | null
          portal_run_id?: string | null
          portal_status?: string | null
          portal_submitted_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          ride_started_at?: string | null
          rider_id?: string
          robot_captured_at?: string | null
          robot_captured_claim?: Json | null
          robot_confirmation_number?: string | null
          robot_job_id?: string | null
          robot_job_started_at?: string | null
          robot_last_checked_at?: string | null
          robot_last_message?: string | null
          robot_last_status?: string | null
          robot_pass?: string | null
          robot_worker_id?: string | null
          robot_worker_url?: string | null
          signature_name?: string | null
          signature_path?: string | null
          signed_by_escort?: boolean | null
          state_pdf_generated_at?: string | null
          state_pdf_path?: string | null
          status?: Database["public"]["Enums"]["medicaid_trip_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_confirmation?: string | null
          trip_kind?: Database["public"]["Enums"]["nemt_trip_kind"] | null
          updated_at?: string
          vehicle_plate?: string | null
          vehicle_type?: Database["public"]["Enums"]["nemt_vehicle_type"] | null
          vehicle_vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicaid_trips_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicaid_trips_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          driver_id: string
          id: string
          read: boolean
          receiver_id: string | null
          sender_id: string
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          body: string
          created_at?: string
          driver_id: string
          id?: string
          read?: boolean
          receiver_id?: string | null
          sender_id: string
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          body?: string
          created_at?: string
          driver_id?: string
          id?: string
          read?: boolean
          receiver_id?: string | null
          sender_id?: string
          sender_role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      news_items: {
        Row: {
          body: string
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          link_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      paper_inbox_files: {
        Row: {
          attempts: number
          billing_record_id: string | null
          company_id: string
          content_hash: string | null
          created_at: string
          draft: Json | null
          error: string | null
          file_name: string
          id: string
          mime: string
          ocr: Json | null
          processed_at: string | null
          status: string
          storage_bucket: string
          storage_path: string
          trip_id: string | null
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          attempts?: number
          billing_record_id?: string | null
          company_id: string
          content_hash?: string | null
          created_at?: string
          draft?: Json | null
          error?: string | null
          file_name?: string
          id?: string
          mime?: string
          ocr?: Json | null
          processed_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path: string
          trip_id?: string | null
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          attempts?: number
          billing_record_id?: string | null
          company_id?: string
          content_hash?: string | null
          created_at?: string
          draft?: Json | null
          error?: string | null
          file_name?: string
          id?: string
          mime?: string
          ocr?: Json | null
          processed_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          trip_id?: string | null
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_inbox_files_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      passengers: {
        Row: {
          address: string | null
          approx_city: string | null
          approx_region: string | null
          company_id: string | null
          county: string | null
          created_at: string
          date_of_birth: string | null
          device_id: string | null
          email: string | null
          first_name: string
          id: string
          is_active: boolean
          last_ip: string | null
          last_name: string
          last_seen_at: string | null
          medicaid_id: string | null
          notes: string | null
          phone: string | null
          ssn_last4: string | null
          ssn_secret_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          approx_city?: string | null
          approx_region?: string | null
          company_id?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          device_id?: string | null
          email?: string | null
          first_name: string
          id?: string
          is_active?: boolean
          last_ip?: string | null
          last_name: string
          last_seen_at?: string | null
          medicaid_id?: string | null
          notes?: string | null
          phone?: string | null
          ssn_last4?: string | null
          ssn_secret_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          approx_city?: string | null
          approx_region?: string | null
          company_id?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          device_id?: string | null
          email?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_ip?: string | null
          last_name?: string
          last_seen_at?: string | null
          medicaid_id?: string | null
          notes?: string | null
          phone?: string | null
          ssn_last4?: string | null
          ssn_secret_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "passengers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string | null
          created_at: string
          data: Json | null
          id: string
          notes: string | null
          payroll_item_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          notes?: string | null
          payroll_item_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          notes?: string | null
          payroll_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_audit_log_payroll_item_id_fkey"
            columns: ["payroll_item_id"]
            isOneToOne: false
            referencedRelation: "payroll_items"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          amount: number
          category: string | null
          claim_number: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string
          id: string
          kind: string
          notes: string | null
          passenger_name: string | null
          payout_id: string | null
          payroll_status: string
          ref_id: string | null
          service_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          category?: string | null
          claim_number?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id: string
          id?: string
          kind?: string
          notes?: string | null
          passenger_name?: string | null
          payout_id?: string | null
          payroll_status?: string
          ref_id?: string | null
          service_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          claim_number?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id?: string
          id?: string
          kind?: string
          notes?: string | null
          passenger_name?: string | null
          payout_id?: string | null
          payroll_status?: string
          ref_id?: string | null
          service_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_config: {
        Row: {
          base_fare: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          per_km: number
          per_minute: number
          updated_at: string
        }
        Insert: {
          base_fare?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          per_km?: number
          per_minute?: number
          updated_at?: string
        }
        Update: {
          base_fare?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          per_km?: number
          per_minute?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          phone: string | null
          sms_alerts_enabled: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          sms_alerts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          sms_alerts_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rewards_settings: {
        Row: {
          enabled: boolean
          id: boolean
          period_type: string
          prize_description: string
          rides_required: number
          updated_at: string
          winners_per_period: number
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          period_type?: string
          prize_description?: string
          rides_required?: number
          updated_at?: string
          winners_per_period?: number
        }
        Update: {
          enabled?: boolean
          id?: boolean
          period_type?: string
          prize_description?: string
          rides_required?: number
          updated_at?: string
          winners_per_period?: number
        }
        Relationships: []
      }
      ride_passengers: {
        Row: {
          created_at: string
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          dropoff_sequence: number | null
          dropped_off_at: string | null
          id: string
          medicaid_id: string | null
          name: string
          phone: string | null
          picked_up_at: string | null
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_sequence: number | null
          request_id: string | null
          trip_id: string | null
        }
        Insert: {
          created_at?: string
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_sequence?: number | null
          dropped_off_at?: string | null
          id?: string
          medicaid_id?: string | null
          name: string
          phone?: string | null
          picked_up_at?: string | null
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_sequence?: number | null
          request_id?: string | null
          trip_id?: string | null
        }
        Update: {
          created_at?: string
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_sequence?: number | null
          dropped_off_at?: string | null
          id?: string
          medicaid_id?: string | null
          name?: string
          phone?: string | null
          picked_up_at?: string | null
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_sequence?: number | null
          request_id?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_passengers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ride_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_passengers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_requests: {
        Row: {
          company_id: string | null
          contact_medicaid: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          declined_driver_ids: string[]
          distance_km: number | null
          driver_id: string | null
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          estimated_fare: number | null
          estimated_minutes: number | null
          group_size: number
          id: string
          is_group: boolean
          notes: string | null
          offer_expires_at: string | null
          passenger_id: string | null
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          requested_pickup_time: string | null
          ride_purpose: string | null
          source: string
          status: string
          stops: Json
          trip_id: string | null
          updated_at: string
          vehicle_type: string | null
        }
        Insert: {
          company_id?: string | null
          contact_medicaid?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          declined_driver_ids?: string[]
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_fare?: number | null
          estimated_minutes?: number | null
          group_size?: number
          id?: string
          is_group?: boolean
          notes?: string | null
          offer_expires_at?: string | null
          passenger_id?: string | null
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          requested_pickup_time?: string | null
          ride_purpose?: string | null
          source?: string
          status?: string
          stops?: Json
          trip_id?: string | null
          updated_at?: string
          vehicle_type?: string | null
        }
        Update: {
          company_id?: string | null
          contact_medicaid?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          declined_driver_ids?: string[]
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_fare?: number | null
          estimated_minutes?: number | null
          group_size?: number
          id?: string
          is_group?: boolean
          notes?: string | null
          offer_expires_at?: string | null
          passenger_id?: string | null
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          requested_pickup_time?: string | null
          ride_purpose?: string | null
          source?: string
          status?: string
          stops?: Json
          trip_id?: string | null
          updated_at?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_requests_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_requests_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          address: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          dob: string | null
          full_name: string
          id: string
          last_4_ssn: string | null
          medicaid_id: string
          notes: string | null
          phone: string | null
          ssn_secret_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          full_name: string
          id?: string
          last_4_ssn?: string | null
          medicaid_id: string
          notes?: string | null
          phone?: string | null
          ssn_secret_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          full_name?: string
          id?: string
          last_4_ssn?: string | null
          medicaid_id?: string
          notes?: string | null
          phone?: string | null
          ssn_secret_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "riders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      robot_api_keys: {
        Row: {
          api_key: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
        }
        Insert: {
          api_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
        }
        Update: {
          api_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      robot_workers: {
        Row: {
          base_url: string
          company_ids: string[] | null
          created_at: string
          enabled: boolean
          failure_streak: number
          id: string
          last_health_error: string | null
          last_health_ok_at: string | null
          max_active_jobs: number
          notes: string | null
          unhealthy_until: string | null
          updated_at: string
        }
        Insert: {
          base_url: string
          company_ids?: string[] | null
          created_at?: string
          enabled?: boolean
          failure_streak?: number
          id: string
          last_health_error?: string | null
          last_health_ok_at?: string | null
          max_active_jobs?: number
          notes?: string | null
          unhealthy_until?: string | null
          updated_at?: string
        }
        Update: {
          base_url?: string
          company_ids?: string[] | null
          created_at?: string
          enabled?: boolean
          failure_streak?: number
          id?: string
          last_health_error?: string | null
          last_health_ok_at?: string | null
          max_active_jobs?: number
          notes?: string | null
          unhealthy_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      route_stops: {
        Row: {
          address: string
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          lat: number | null
          leg: string
          lng: number | null
          notes: string | null
          passenger_medicaid_id: string | null
          passenger_name: string | null
          passenger_phone: string | null
          request_id: string | null
          route_id: string
          sequence: number
        }
        Insert: {
          address: string
          completed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          lat?: number | null
          leg?: string
          lng?: number | null
          notes?: string | null
          passenger_medicaid_id?: string | null
          passenger_name?: string | null
          passenger_phone?: string | null
          request_id?: string | null
          route_id: string
          sequence?: number
        }
        Update: {
          address?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          lat?: number | null
          leg?: string
          lng?: number | null
          notes?: string | null
          passenger_medicaid_id?: string | null
          passenger_name?: string | null
          passenger_phone?: string | null
          request_id?: string | null
          route_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ride_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          company_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          name: string | null
          notes: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          address: string
          created_at: string
          id: string
          kind: string
          label: string
          lat: number
          lng: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          kind?: string
          label: string
          lat: number
          lng: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          lat?: number
          lng?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          driver_id: string
          end_time: string
          id: string
          notes: string | null
          shift_date: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          end_time: string
          id?: string
          notes?: string | null
          shift_date: string
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          end_time?: string
          id?: string
          notes?: string | null
          shift_date?: string
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_conversations: {
        Row: {
          company_id: string
          contact_name: string | null
          contact_phone: string
          created_at: string
          id: string
          is_known_contact: boolean
          last_inbound_at: string | null
          last_message_at: string | null
          our_number: string
          passenger_id: string | null
          status: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          id?: string
          is_known_contact?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          our_number: string
          passenger_id?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          id?: string
          is_known_contact?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          our_number?: string
          passenger_id?: string | null
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_conversations_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          attempt_count: number
          body: string
          company_id: string
          conversation_id: string
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          direction: string
          error_message: string | null
          event_kind: string | null
          from_number: string
          id: string
          metadata: Json
          provider: string
          provider_message_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          body: string
          company_id: string
          conversation_id: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          direction: string
          error_message?: string | null
          event_kind?: string | null
          from_number: string
          id?: string
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          body?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          event_kind?: string | null
          from_number?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sms_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_conversations: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          member_a: string
          member_b: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          member_a: string
          member_b: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          member_a?: string
          member_b?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "staff_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      state_portal_credentials: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          last_used_at: string | null
          login_email: string
          password_fingerprint: string | null
          password_last4: string | null
          password_len: number | null
          password_secret_id: string | null
          password_updated_at: string | null
          portal_id: string
          portal_name: string
          state: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          login_email: string
          password_fingerprint?: string | null
          password_last4?: string | null
          password_len?: number | null
          password_secret_id?: string | null
          password_updated_at?: string | null
          portal_id: string
          portal_name: string
          state: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          login_email?: string
          password_fingerprint?: string | null
          password_last4?: string | null
          password_len?: number | null
          password_secret_id?: string | null
          password_updated_at?: string | null
          portal_id?: string
          portal_name?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      submission_batches: {
        Row: {
          auto_pilot: boolean
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          total_enqueued: number
          total_rejected: number
          total_requested: number
          updated_at: string
          wave_size: number
        }
        Insert: {
          auto_pilot?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          total_enqueued?: number
          total_rejected?: number
          total_requested?: number
          updated_at?: string
          wave_size?: number
        }
        Update: {
          auto_pilot?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          total_enqueued?: number
          total_rejected?: number
          total_requested?: number
          updated_at?: string
          wave_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "submission_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_queue_state: {
        Row: {
          id: boolean
          last_result: Json
          last_run_at: string | null
          pause_reason: string | null
          paused: boolean
          paused_by: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_result?: Json
          last_run_at?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          id: string
          method: string
          notes: string | null
          paid_on: string
          period_end: string | null
          period_start: string | null
          recorded_by: string | null
          reference: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          paid_on?: string
          period_end?: string | null
          period_start?: string | null
          recorded_by?: string | null
          reference?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          paid_on?: string
          period_end?: string | null
          period_start?: string | null
          recorded_by?: string | null
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_billing_records: {
        Row: {
          amount: number
          created_at: string
          diagnosis_code: string | null
          id: string
          paid_at: string | null
          rate_per_unit: number
          service_code: string | null
          status: Database["public"]["Enums"]["billing_status"]
          submitted_at: string | null
          trip_id: string
          units: number
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          diagnosis_code?: string | null
          id?: string
          paid_at?: string | null
          rate_per_unit?: number
          service_code?: string | null
          status?: Database["public"]["Enums"]["billing_status"]
          submitted_at?: string | null
          trip_id: string
          units?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          diagnosis_code?: string | null
          id?: string
          paid_at?: string | null
          rate_per_unit?: number
          service_code?: string | null
          status?: Database["public"]["Enums"]["billing_status"]
          submitted_at?: string | null
          trip_id?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_destination_classifications: {
        Row: {
          classified_at: string
          classifier_version: string
          company_id: string | null
          confidence: number
          created_at: string
          destination_text: string | null
          evidence: Json
          id: string
          matched: Json
          reasons: Json
          status: string
          summary: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          classified_at?: string
          classifier_version: string
          company_id?: string | null
          confidence?: number
          created_at?: string
          destination_text?: string | null
          evidence?: Json
          id?: string
          matched?: Json
          reasons?: Json
          status: string
          summary?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          classified_at?: string
          classifier_version?: string
          company_id?: string | null
          confidence?: number
          created_at?: string
          destination_text?: string | null
          evidence?: Json
          id?: string
          matched?: Json
          reasons?: Json
          status?: string
          summary?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_destination_classifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_destination_classifications_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "medicaid_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_media: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          kind: string
          storage_path: string
          trip_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          kind: string
          storage_path: string
          trip_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          kind?: string
          storage_path?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_media_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_stops: {
        Row: {
          added_by: string
          address: string
          arrived_at: string | null
          created_at: string
          departed_at: string | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          passenger_medicaid_id: string | null
          passenger_name: string | null
          sequence: number
          trip_id: string
        }
        Insert: {
          added_by?: string
          address: string
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          passenger_medicaid_id?: string | null
          passenger_name?: string | null
          sequence?: number
          trip_id: string
        }
        Update: {
          added_by?: string
          address?: string
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          passenger_medicaid_id?: string | null
          passenger_name?: string | null
          sequence?: number
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_stops_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          actual_dropoff_time: string | null
          actual_pickup_time: string | null
          assignment_type: string
          billing_status: Database["public"]["Enums"]["billing_status"]
          company_id: string | null
          computed_miles: number | null
          created_at: string
          driver_id: string | null
          driver_rating: number | null
          driver_rating_note: string | null
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          estimated_arrival_at: string | null
          estimated_fare: number | null
          gps_miles: number | null
          gps_route: Json
          hcpf_claim_number: string | null
          id: string
          identity_verified: boolean | null
          is_problem: boolean
          notes: string | null
          odometer_end: number | null
          odometer_end_photo: string | null
          odometer_start: number | null
          odometer_start_photo: string | null
          passenger_id: string
          passenger_rating: number | null
          passenger_rating_note: string | null
          patient_confirmed: boolean
          patient_confirmed_at: string | null
          payout_id: string | null
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          problem_reason: string | null
          ride_purpose: string | null
          round_trip_group_id: string | null
          round_trip_leg: number | null
          scheduled_pickup_time: string
          signature_url: string | null
          signed_at: string | null
          signer_name: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
          waypoints: Json
        }
        Insert: {
          actual_dropoff_time?: string | null
          actual_pickup_time?: string | null
          assignment_type?: string
          billing_status?: Database["public"]["Enums"]["billing_status"]
          company_id?: string | null
          computed_miles?: number | null
          created_at?: string
          driver_id?: string | null
          driver_rating?: number | null
          driver_rating_note?: string | null
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_arrival_at?: string | null
          estimated_fare?: number | null
          gps_miles?: number | null
          gps_route?: Json
          hcpf_claim_number?: string | null
          id?: string
          identity_verified?: boolean | null
          is_problem?: boolean
          notes?: string | null
          odometer_end?: number | null
          odometer_end_photo?: string | null
          odometer_start?: number | null
          odometer_start_photo?: string | null
          passenger_id: string
          passenger_rating?: number | null
          passenger_rating_note?: string | null
          patient_confirmed?: boolean
          patient_confirmed_at?: string | null
          payout_id?: string | null
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          problem_reason?: string | null
          ride_purpose?: string | null
          round_trip_group_id?: string | null
          round_trip_leg?: number | null
          scheduled_pickup_time: string
          signature_url?: string | null
          signed_at?: string | null
          signer_name?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
          waypoints?: Json
        }
        Update: {
          actual_dropoff_time?: string | null
          actual_pickup_time?: string | null
          assignment_type?: string
          billing_status?: Database["public"]["Enums"]["billing_status"]
          company_id?: string | null
          computed_miles?: number | null
          created_at?: string
          driver_id?: string | null
          driver_rating?: number | null
          driver_rating_note?: string | null
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_arrival_at?: string | null
          estimated_fare?: number | null
          gps_miles?: number | null
          gps_route?: Json
          hcpf_claim_number?: string | null
          id?: string
          identity_verified?: boolean | null
          is_problem?: boolean
          notes?: string | null
          odometer_end?: number | null
          odometer_end_photo?: string | null
          odometer_start?: number | null
          odometer_start_photo?: string | null
          passenger_id?: string
          passenger_rating?: number | null
          passenger_rating_note?: string | null
          patient_confirmed?: boolean
          patient_confirmed_at?: string | null
          payout_id?: string | null
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          problem_reason?: string | null
          ride_purpose?: string | null
          round_trip_group_id?: string | null
          round_trip_leg?: number | null
          scheduled_pickup_time?: string
          signature_url?: string | null
          signed_at?: string | null
          signer_name?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
          waypoints?: Json
        }
        Relationships: [
          {
            foreignKeyName: "trips_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "driver_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_expenses: {
        Row: {
          amount: number
          category: string
          company_id: string | null
          created_at: string
          created_by: string | null
          driver_id: string
          expense_date: string
          id: string
          notes: string | null
          odometer: number | null
          receipt_path: string | null
          updated_at: string
          vehicle_label: string | null
          vehicle_plate: string | null
          vendor: string | null
        }
        Insert: {
          amount?: number
          category?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id: string
          expense_date: string
          id?: string
          notes?: string | null
          odometer?: number | null
          receipt_path?: string | null
          updated_at?: string
          vehicle_label?: string | null
          vehicle_plate?: string | null
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string
          expense_date?: string
          id?: string
          notes?: string | null
          odometer?: number | null
          receipt_path?: string | null
          updated_at?: string
          vehicle_label?: string | null
          vehicle_plate?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expenses_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      claim_status_queue_metrics: {
        Row: {
          avg_check_ms: number | null
          checked_last_hour: number | null
          company_id: string | null
          company_name: string | null
          due_now: number | null
          errored: number | null
          last_checked_at: string | null
          leased_running: number | null
          oldest_due_at: string | null
          retrying: number | null
          scheduled_total: number | null
          stale_locks: number | null
          terminal: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_queue_metrics: {
        Row: {
          avg_submit_ms: number | null
          company_id: string | null
          company_name: string | null
          last_submitted_at: string | null
          leased: number | null
          needs_attention: number | null
          oldest_queued_at: string | null
          processing: number | null
          queued: number | null
          retrying: number | null
          stale_locks: number | null
          submitted_last_hour: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_view_driver_media: {
        Args: { _driver_user_id: string }
        Returns: boolean
      }
      company_is_active: { Args: { _company_id: string }; Returns: boolean }
      company_of_driver: { Args: { _driver_id: string }; Returns: string }
      company_of_ride_request: {
        Args: { _request_id: string }
        Returns: string
      }
      company_of_route: { Args: { _route_id: string }; Returns: string }
      company_of_trip: { Args: { _trip_id: string }; Returns: string }
      copy_passenger_ssn_to_rider: {
        Args: { _passenger_id: string; _rider_id: string }
        Returns: undefined
      }
      current_user_can_bill: { Args: never; Returns: boolean }
      current_user_company_id: { Args: never; Returns: string }
      current_user_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      current_user_is_billing: { Args: never; Returns: boolean }
      current_user_is_dispatch: { Args: never; Returns: boolean }
      current_user_sees_all_bills: { Args: never; Returns: boolean }
      driver_can_see_passenger: {
        Args: { _passenger_id: string }
        Returns: boolean
      }
      driver_can_see_rider: { Args: { _rider_id: string }; Returns: boolean }
      get_decrypted_passenger_ssn: {
        Args: { _passenger_id: string }
        Returns: string
      }
      get_decrypted_rider_ssn: { Args: { _rider_id: string }; Returns: string }
      get_portal_credential_for_submission: {
        Args: { _company_id?: string; _portal_id: string }
        Returns: {
          fingerprint_matches: boolean
          login_email: string
          login_password: string
          password_fingerprint: string
          password_len: number
          password_updated_at: string
          portal_id: string
          portal_name: string
          state: string
          stored_fingerprint: string
        }[]
      }
      get_public_trip_track: { Args: { _trip_id: string }; Returns: Json }
      get_ride_request_view: { Args: { _request_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_owner: { Args: never; Returns: boolean }
      is_staff_conversation_member: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      lease_claim_status_jobs: {
        Args: {
          _global_limit?: number
          _lease_seconds?: number
          _per_company_limit?: number
          _record_ids?: string[]
          _worker?: string
        }
        Returns: {
          claim_number: string
          company_id: string
          id: string
          status: string
          status_check_attempts: number
          trip_id: string
        }[]
      }
      lease_reconcile_jobs: {
        Args: {
          _global_limit: number
          _lease_seconds: number
          _per_company_limit: number
          _worker: string
        }
        Returns: {
          attempts: number
          billing_record_id: string
          company_id: string
          id: string
          member_id: string
          service_date: string
          sweep_id: string
          trip_id: string
        }[]
      }
      lease_submission_jobs: {
        Args: {
          _company_id?: string
          _global_limit?: number
          _lease_seconds?: number
          _per_company_limit?: number
          _record_ids?: string[]
          _stale_seconds?: number
          _worker?: string
        }
        Returns: {
          attempt: number
          company_id: string
          id: string
          trip_id: string
        }[]
      }
      owner_unscoped: { Args: never; Returns: boolean }
      portal_credential_fingerprint: {
        Args: { _company_id?: string; _portal_id: string }
        Returns: {
          last_used_at: string
          live_fingerprint: string
          login_email: string
          matches: boolean
          password_fingerprint: string
          password_last4: string
          password_len: number
          password_updated_at: string
          portal_id: string
        }[]
      }
      record_robot_worker_health: {
        Args: {
          _base_url: string
          _cooldown_seconds?: number
          _error?: string
          _id: string
          _ok: boolean
        }
        Returns: undefined
      }
      release_stale_claim_status_locks: {
        Args: { _grace_seconds?: number }
        Returns: number
      }
      release_stale_reconcile_locks: {
        Args: { _grace_seconds: number }
        Returns: number
      }
      release_stale_submission_locks: {
        Args: { _grace_seconds?: number }
        Returns: number
      }
      requests_on_route: {
        Args: { _ids: string[] }
        Returns: {
          request_id: string
        }[]
      }
      set_default_billing_portal: {
        Args: { _company_id?: string; _portal_id: string }
        Returns: undefined
      }
      set_default_billing_provider: {
        Args: { _company_id: string; _provider_id: string }
        Returns: undefined
      }
      set_passenger_ssn: {
        Args: { _passenger_id: string; _ssn: string }
        Returns: undefined
      }
      set_rider_ssn: {
        Args: { _rider_id: string; _ssn: string }
        Returns: undefined
      }
      upsert_portal_credential: {
        Args: {
          _company_id?: string
          _login_email: string
          _login_password: string
          _portal_id: string
          _portal_name: string
          _state: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "driver"
        | "passenger"
        | "dispatch"
        | "platform_owner"
        | "billing"
        | "admin_biller"
      billing_status: "pending" | "submitted" | "paid" | "rejected"
      driver_pay_type: "per_hour" | "commission"
      driver_status: "available" | "busy" | "offline"
      incident_status: "open" | "reviewed" | "closed"
      incident_type:
        | "accident"
        | "late"
        | "no_show"
        | "complaint"
        | "mechanical"
        | "other"
      medicaid_trip_status:
        | "pending_review"
        | "approved"
        | "rejected"
        | "submitted"
        | "needs_fix"
      nemt_trip_kind: "one_way" | "round_trip" | "group_tour"
      nemt_vehicle_type:
        | "ground_ambulance"
        | "wheelchair_van"
        | "stretcher_van"
        | "taxi"
        | "ambulatory"
      shift_status: "scheduled" | "completed" | "no_show"
      trip_status:
        | "scheduled"
        | "assigned"
        | "driver_en_route_to_pickup"
        | "arrived_at_pickup"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "driver",
        "passenger",
        "dispatch",
        "platform_owner",
        "billing",
        "admin_biller",
      ],
      billing_status: ["pending", "submitted", "paid", "rejected"],
      driver_pay_type: ["per_hour", "commission"],
      driver_status: ["available", "busy", "offline"],
      incident_status: ["open", "reviewed", "closed"],
      incident_type: [
        "accident",
        "late",
        "no_show",
        "complaint",
        "mechanical",
        "other",
      ],
      medicaid_trip_status: [
        "pending_review",
        "approved",
        "rejected",
        "submitted",
        "needs_fix",
      ],
      nemt_trip_kind: ["one_way", "round_trip", "group_tour"],
      nemt_vehicle_type: [
        "ground_ambulance",
        "wheelchair_van",
        "stretcher_van",
        "taxi",
        "ambulatory",
      ],
      shift_status: ["scheduled", "completed", "no_show"],
      trip_status: [
        "scheduled",
        "assigned",
        "driver_en_route_to_pickup",
        "arrived_at_pickup",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
    },
  },
} as const

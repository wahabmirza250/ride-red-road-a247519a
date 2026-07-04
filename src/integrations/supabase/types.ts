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
      billing_records: {
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
      drivers: {
        Row: {
          created_at: string
          current_lat: number | null
          current_lng: number | null
          default_plate: string | null
          default_vehicle_type:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin: string | null
          id: string
          is_online: boolean
          last_location_at: string | null
          license_number: string | null
          photo_url: string | null
          rating: number
          status: Database["public"]["Enums"]["driver_status"]
          total_ratings: number
          total_trips: number
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_year: number | null
        }
        Insert: {
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          default_plate?: string | null
          default_vehicle_type?:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin?: string | null
          id?: string
          is_online?: boolean
          last_location_at?: string | null
          license_number?: string | null
          photo_url?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_ratings?: number
          total_trips?: number
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_year?: number | null
        }
        Update: {
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          default_plate?: string | null
          default_vehicle_type?:
            | Database["public"]["Enums"]["nemt_vehicle_type"]
            | null
          default_vin?: string | null
          id?: string
          is_online?: boolean
          last_location_at?: string | null
          license_number?: string | null
          photo_url?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["driver_status"]
          total_ratings?: number
          total_trips?: number
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_year?: number | null
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
          created_at: string
          driver_id: string
          dropoff_address: string
          escort_name: string | null
          group_id: string | null
          id: string
          identity_verified: boolean | null
          miles: number
          odometer_end: number
          odometer_start: number
          pickup_address: string
          pickup_at: string
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
          rider_id: string
          signature_name: string | null
          signature_path: string | null
          signed_by_escort: boolean | null
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
          created_at?: string
          driver_id: string
          dropoff_address: string
          escort_name?: string | null
          group_id?: string | null
          id?: string
          identity_verified?: boolean | null
          miles: number
          odometer_end: number
          odometer_start: number
          pickup_address: string
          pickup_at: string
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
          rider_id: string
          signature_name?: string | null
          signature_path?: string | null
          signed_by_escort?: boolean | null
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
          created_at?: string
          driver_id?: string
          dropoff_address?: string
          escort_name?: string | null
          group_id?: string | null
          id?: string
          identity_verified?: boolean | null
          miles?: number
          odometer_end?: number
          odometer_start?: number
          pickup_address?: string
          pickup_at?: string
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
          rider_id?: string
          signature_name?: string | null
          signature_path?: string | null
          signed_by_escort?: boolean | null
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
      passengers: {
        Row: {
          address: string | null
          approx_city: string | null
          approx_region: string | null
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
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          approx_city?: string | null
          approx_region?: string | null
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
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          approx_city?: string | null
          approx_region?: string | null
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
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ride_requests: {
        Row: {
          contact_medicaid: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          distance_km: number | null
          driver_id: string | null
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          estimated_fare: number | null
          estimated_minutes: number | null
          id: string
          notes: string | null
          passenger_id: string | null
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          requested_pickup_time: string | null
          source: string
          status: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          contact_medicaid?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_fare?: number | null
          estimated_minutes?: number | null
          id?: string
          notes?: string | null
          passenger_id?: string | null
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          requested_pickup_time?: string | null
          source?: string
          status?: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_medicaid?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          estimated_fare?: number | null
          estimated_minutes?: number | null
          id?: string
          notes?: string | null
          passenger_id?: string | null
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          requested_pickup_time?: string | null
          source?: string
          status?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
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
          created_at: string
          created_by: string | null
          dob: string | null
          full_name: string
          id: string
          medicaid_id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          full_name: string
          id?: string
          medicaid_id: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          full_name?: string
          id?: string
          medicaid_id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
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
      trips: {
        Row: {
          actual_dropoff_time: string | null
          actual_pickup_time: string | null
          assignment_type: string
          billing_status: Database["public"]["Enums"]["billing_status"]
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
          pickup_address: string
          pickup_lat: number | null
          pickup_lng: number | null
          problem_reason: string | null
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
          pickup_address: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          problem_reason?: string | null
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
          pickup_address?: string
          pickup_lat?: number | null
          pickup_lng?: number | null
          problem_reason?: string | null
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
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "driver" | "passenger"
      billing_status: "pending" | "submitted" | "paid" | "rejected"
      driver_status: "available" | "on_trip" | "offline"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "driver", "passenger"],
      billing_status: ["pending", "submitted", "paid", "rejected"],
      driver_status: ["available", "on_trip", "offline"],
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

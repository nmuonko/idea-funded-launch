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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action_type: string
          admin_email: string | null
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string | null
          target_section: string | null
        }
        Insert: {
          action_type: string
          admin_email?: string | null
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_section?: string | null
        }
        Update: {
          action_type?: string
          admin_email?: string | null
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_section?: string | null
        }
        Relationships: []
      }
      admin_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          email_sent: boolean | null
          expires_at: string
          id: string
          invite_url: string | null
          invited_by: string
          role: string
          status: string
          token: string
          token_hash: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          email_sent?: boolean | null
          expires_at?: string
          id?: string
          invite_url?: string | null
          invited_by: string
          role?: string
          status?: string
          token?: string
          token_hash?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          email_sent?: boolean | null
          expires_at?: string
          id?: string
          invite_url?: string | null
          invited_by?: string
          role?: string
          status?: string
          token?: string
          token_hash?: string | null
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      admin_user_permissions: {
        Row: {
          can_manage_shipping_types: boolean
          can_manage_users: boolean
          can_view_ab_results: boolean
          can_view_active_carts: boolean
          can_view_analytics: boolean
          can_view_customers: boolean
          can_view_dashboard: boolean
          can_view_knowledge_base: boolean
          can_view_orders: boolean
          can_view_payments: boolean
          can_view_saved_carts: boolean
          can_view_settings: boolean
          can_view_shipping: boolean
          can_view_theme_settings: boolean
          can_view_ticket_analytics: boolean
          can_view_tickets: boolean
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_manage_shipping_types?: boolean
          can_manage_users?: boolean
          can_view_ab_results?: boolean
          can_view_active_carts?: boolean
          can_view_analytics?: boolean
          can_view_customers?: boolean
          can_view_dashboard?: boolean
          can_view_knowledge_base?: boolean
          can_view_orders?: boolean
          can_view_payments?: boolean
          can_view_saved_carts?: boolean
          can_view_settings?: boolean
          can_view_shipping?: boolean
          can_view_theme_settings?: boolean
          can_view_ticket_analytics?: boolean
          can_view_tickets?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_manage_shipping_types?: boolean
          can_manage_users?: boolean
          can_view_ab_results?: boolean
          can_view_active_carts?: boolean
          can_view_analytics?: boolean
          can_view_customers?: boolean
          can_view_dashboard?: boolean
          can_view_knowledge_base?: boolean
          can_view_orders?: boolean
          can_view_payments?: boolean
          can_view_saved_carts?: boolean
          can_view_settings?: boolean
          can_view_shipping?: boolean
          can_view_theme_settings?: boolean
          can_view_ticket_analytics?: boolean
          can_view_tickets?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      ai_action_queue: {
        Row: {
          action_type: string
          ai_decision: Json
          confidence_score: number | null
          created_at: string | null
          executed_at: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action_type: string
          ai_decision: Json
          confidence_score?: number | null
          created_at?: string | null
          executed_at?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action_type?: string
          ai_decision?: Json
          confidence_score?: number | null
          created_at?: string | null
          executed_at?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      ai_assistant_logs: {
        Row: {
          action_type: string
          created_at: string
          id: string
          metadata: Json | null
          order_id: string | null
          prompt: string | null
          response: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          prompt?: string | null
          response?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          prompt?: string | null
          response?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_ingest_queue: {
        Row: {
          attempts: number
          category_key: string | null
          created_at: string
          id: number
          last_error: string | null
          priority: number
          query: string
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          category_key?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          priority?: number
          query: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          category_key?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          priority?: number
          query?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_runtime_config: {
        Row: {
          blocks: Json
          env: string
          filters: Json
          home: Json
          id: string
          providers: Json
          search: Json
          ui: Json
          updated_at: string
          version: number
        }
        Insert: {
          blocks?: Json
          env: string
          filters?: Json
          home?: Json
          id?: string
          providers?: Json
          search?: Json
          ui?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          blocks?: Json
          env?: string
          filters?: Json
          home?: Json
          id?: string
          providers?: Json
          search?: Json
          ui?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      auto_seed_promotions: {
        Row: {
          admin_notes: string | null
          avg_result_count: number | null
          category_key: string | null
          created_at: string
          first_seen_at: string
          id: string
          last_refresh_count: number | null
          last_refresh_status: string | null
          last_refreshed_at: string | null
          promoted_at: string | null
          query_normalized: string
          search_count: number
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          avg_result_count?: number | null
          category_key?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_refresh_count?: number | null
          last_refresh_status?: string | null
          last_refreshed_at?: string | null
          promoted_at?: string | null
          query_normalized: string
          search_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          avg_result_count?: number | null
          category_key?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_refresh_count?: number | null
          last_refresh_status?: string | null
          last_refreshed_at?: string | null
          promoted_at?: string | null
          query_normalized?: string
          search_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      bank_transfer_settings: {
        Row: {
          account_number_or_iban: string
          bank_name: string
          beneficiary_name: string
          created_at: string
          id: string
          instructions_en: string | null
          instructions_fr: string | null
          is_active: boolean
          support_email: string | null
          support_whatsapp: string | null
          swift_bic: string | null
          updated_at: string
        }
        Insert: {
          account_number_or_iban?: string
          bank_name?: string
          beneficiary_name?: string
          created_at?: string
          id?: string
          instructions_en?: string | null
          instructions_fr?: string | null
          is_active?: boolean
          support_email?: string | null
          support_whatsapp?: string | null
          swift_bic?: string | null
          updated_at?: string
        }
        Update: {
          account_number_or_iban?: string
          bank_name?: string
          beneficiary_name?: string
          created_at?: string
          id?: string
          instructions_en?: string | null
          instructions_fr?: string | null
          is_active?: boolean
          support_email?: string | null
          support_whatsapp?: string | null
          swift_bic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bank_transfer_submissions: {
        Row: {
          contact: string | null
          created_at: string
          file_path: string
          id: string
          name: string | null
          notes: string | null
          reference: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          file_path: string
          id?: string
          name?: string | null
          notes?: string | null
          reference: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          file_path?: string
          id?: string
          name?: string | null
          notes?: string | null
          reference?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      bank_transfer_view_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          order_id: string
          token: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          order_id: string
          token: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          order_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transfer_view_tokens_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      cars_api_usage: {
        Row: {
          day: string
          estimated_cost_usd: number
          id: string
          month: string
          total_calls: number
          updated_at: string
        }
        Insert: {
          day?: string
          estimated_cost_usd?: number
          id?: string
          month?: string
          total_calls?: number
          updated_at?: string
        }
        Update: {
          day?: string
          estimated_cost_usd?: number
          id?: string
          month?: string
          total_calls?: number
          updated_at?: string
        }
        Relationships: []
      }
      cars_listings_cache: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          images: Json | null
          is_trending: boolean | null
          listing_url: string | null
          location: string | null
          make: string | null
          mileage: number | null
          model: string | null
          price: number | null
          provider: string
          provider_listing_id: string
          title: string | null
          updated_at: string
          vin: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          images?: Json | null
          is_trending?: boolean | null
          listing_url?: string | null
          location?: string | null
          make?: string | null
          mileage?: number | null
          model?: string | null
          price?: number | null
          provider?: string
          provider_listing_id: string
          title?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          images?: Json | null
          is_trending?: boolean | null
          listing_url?: string | null
          location?: string | null
          make?: string | null
          mileage?: number | null
          model?: string | null
          price?: number | null
          provider?: string
          provider_listing_id?: string
          title?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Relationships: []
      }
      cars_rate_limits: {
        Row: {
          id: string
          identifier: string
          identifier_type: string
          request_count: number
          updated_at: string
          window_date: string
        }
        Insert: {
          id?: string
          identifier: string
          identifier_type: string
          request_count?: number
          updated_at?: string
          window_date?: string
        }
        Update: {
          id?: string
          identifier?: string
          identifier_type?: string
          request_count?: number
          updated_at?: string
          window_date?: string
        }
        Relationships: []
      }
      cars_search_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          response_json_min: Json
          result_count: number
          updated_at: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          response_json_min?: Json
          result_count?: number
          updated_at?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          response_json_min?: Json
          result_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      cars_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      cart_recovery_ab_tests: {
        Row: {
          cart_value_usd: number | null
          converted: boolean | null
          converted_at: string | null
          created_at: string | null
          email_opened: boolean | null
          email_opened_at: string | null
          id: string
          order_id: string
          segment: string | null
          sent_at: string
          variant_name: string
        }
        Insert: {
          cart_value_usd?: number | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          email_opened?: boolean | null
          email_opened_at?: string | null
          id?: string
          order_id: string
          segment?: string | null
          sent_at?: string
          variant_name: string
        }
        Update: {
          cart_value_usd?: number | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          email_opened?: boolean | null
          email_opened_at?: string | null
          id?: string
          order_id?: string
          segment?: string | null
          sent_at?: string
          variant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_recovery_ab_tests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_recovery_predictions: {
        Row: {
          ai_reasoning: string | null
          conversion_probability: number | null
          converted_at: string | null
          created_at: string | null
          id: string
          optimal_send_time: string | null
          order_id: string | null
          personalized_body: string | null
          personalized_subject: string | null
          sent_at: string | null
          suggested_discount_percent: number | null
          user_id: string
        }
        Insert: {
          ai_reasoning?: string | null
          conversion_probability?: number | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          optimal_send_time?: string | null
          order_id?: string | null
          personalized_body?: string | null
          personalized_subject?: string | null
          sent_at?: string | null
          suggested_discount_percent?: number | null
          user_id: string
        }
        Update: {
          ai_reasoning?: string | null
          conversion_probability?: number | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          optimal_send_time?: string | null
          order_id?: string | null
          personalized_body?: string | null
          personalized_subject?: string | null
          sent_at?: string | null
          suggested_discount_percent?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_recovery_predictions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_builder_goals: {
        Row: {
          achieved_ebay: number
          achieved_rainforest: number
          achieved_total: number
          continuous: boolean
          created_at: string
          created_by: string | null
          end_at: string
          goal_ebay: number
          goal_rainforest: number
          goal_total: number
          id: string
          last_error: string | null
          last_run_at: string | null
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          achieved_ebay?: number
          achieved_rainforest?: number
          achieved_total?: number
          continuous?: boolean
          created_at?: string
          created_by?: string | null
          end_at: string
          goal_ebay?: number
          goal_rainforest?: number
          goal_total?: number
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          start_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          achieved_ebay?: number
          achieved_rainforest?: number
          achieved_total?: number
          continuous?: boolean
          created_at?: string
          created_by?: string | null
          end_at?: string
          goal_ebay?: number
          goal_rainforest?: number
          goal_total?: number
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_builder_runs: {
        Row: {
          duplicates_skipped: number
          duration_ms: number
          finished_at: string | null
          goal_id: string | null
          id: string
          items_upserted: number
          new_unique_items: number
          provider: string
          rate_limited_count: number
          sources_processed: number
          started_at: string
        }
        Insert: {
          duplicates_skipped?: number
          duration_ms?: number
          finished_at?: string | null
          goal_id?: string | null
          id?: string
          items_upserted?: number
          new_unique_items?: number
          provider: string
          rate_limited_count?: number
          sources_processed?: number
          started_at?: string
        }
        Update: {
          duplicates_skipped?: number
          duration_ms?: number
          finished_at?: string | null
          goal_id?: string | null
          id?: string
          items_upserted?: number
          new_unique_items?: number
          provider?: string
          rate_limited_count?: number
          sources_processed?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_builder_runs_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "catalog_builder_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_builder_sources: {
        Row: {
          category_key: string
          created_at: string
          enabled: boolean
          id: string
          priority: number
          provider: string
          source_type: string
          source_value: string
          updated_at: string
        }
        Insert: {
          category_key: string
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          provider: string
          source_type: string
          source_value: string
          updated_at?: string
        }
        Update: {
          category_key?: string
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          provider?: string
          source_type?: string
          source_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_builder_state: {
        Row: {
          consecutive_zero_new_pages: number
          cooldown_until: string | null
          current_offset: number
          exhausted: boolean
          last_error: string | null
          last_run_at: string | null
          sort_mode: string
          source_id: string
          total_ingested: number
        }
        Insert: {
          consecutive_zero_new_pages?: number
          cooldown_until?: string | null
          current_offset?: number
          exhausted?: boolean
          last_error?: string | null
          last_run_at?: string | null
          sort_mode?: string
          source_id: string
          total_ingested?: number
        }
        Update: {
          consecutive_zero_new_pages?: number
          cooldown_until?: string | null
          current_offset?: number
          exhausted?: boolean
          last_error?: string | null
          last_run_at?: string | null
          sort_mode?: string
          source_id?: string
          total_ingested?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_builder_state_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "catalog_builder_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_cache: {
        Row: {
          amazon_domain: string | null
          cache_key: string
          cache_type: string
          category: string | null
          expires_at: string
          page: number | null
          page_size: number | null
          provider: string | null
          query: string | null
          response: Json
          stale_at: string
          updated_at: string
        }
        Insert: {
          amazon_domain?: string | null
          cache_key: string
          cache_type: string
          category?: string | null
          expires_at: string
          page?: number | null
          page_size?: number | null
          provider?: string | null
          query?: string | null
          response?: Json
          stale_at: string
          updated_at?: string
        }
        Update: {
          amazon_domain?: string | null
          cache_key?: string
          cache_type?: string
          category?: string | null
          expires_at?: string
          page?: number | null
          page_size?: number | null
          provider?: string | null
          query?: string | null
          response?: Json
          stale_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_cache_settings: {
        Row: {
          home_expires_minutes: number | null
          home_stale_minutes: number | null
          key: string
          negative_expires_seconds: number | null
          offers_expires_minutes: number | null
          offers_stale_minutes: number | null
          search_expires_minutes: number | null
          search_stale_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          home_expires_minutes?: number | null
          home_stale_minutes?: number | null
          key?: string
          negative_expires_seconds?: number | null
          offers_expires_minutes?: number | null
          offers_stale_minutes?: number | null
          search_expires_minutes?: number | null
          search_stale_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          home_expires_minutes?: number | null
          home_stale_minutes?: number | null
          key?: string
          negative_expires_seconds?: number | null
          offers_expires_minutes?: number | null
          offers_stale_minutes?: number | null
          search_expires_minutes?: number | null
          search_stale_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_categories: {
        Row: {
          enabled: boolean
          group_title: string
          icon: string | null
          priority: number
          provider_scope: string
          queries: Json
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          group_title?: string
          icon?: string | null
          priority?: number
          provider_scope?: string
          queries?: Json
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          group_title?: string
          icon?: string | null
          priority?: number
          provider_scope?: string
          queries?: Json
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_category_ttl: {
        Row: {
          availability_refresh_days: number | null
          category_key: string
          db_min_results: number | null
          enabled: boolean | null
          max_item_age_days: number | null
          price_refresh_days: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          availability_refresh_days?: number | null
          category_key: string
          db_min_results?: number | null
          enabled?: boolean | null
          max_item_age_days?: number | null
          price_refresh_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          availability_refresh_days?: number | null
          category_key?: string
          db_min_results?: number | null
          enabled?: boolean | null
          max_item_age_days?: number | null
          price_refresh_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      catalog_collection_cache: {
        Row: {
          collection_key: string
          item_ids: Json
          key: string
          page: number
          page_size: number
          provider: string
          total: number
          ttl_seconds: number
          updated_at: string
        }
        Insert: {
          collection_key: string
          item_ids?: Json
          key: string
          page?: number
          page_size?: number
          provider: string
          total?: number
          ttl_seconds?: number
          updated_at?: string
        }
        Update: {
          collection_key?: string
          item_ids?: Json
          key?: string
          page?: number
          page_size?: number
          provider?: string
          total?: number
          ttl_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      catalog_collections: {
        Row: {
          description: string | null
          item_ids: string[] | null
          priority: number | null
          slug: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          item_ids?: string[] | null
          priority?: number | null
          slug: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          item_ids?: string[] | null
          priority?: number | null
          slug?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_config: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      catalog_facets_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          expires_at: string
          facets: Json
          provider: string
          query: string | null
          resolved_key: string
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          expires_at?: string
          facets?: Json
          provider: string
          query?: string | null
          resolved_key: string
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          expires_at?: string
          facets?: Json
          provider?: string
          query?: string | null
          resolved_key?: string
        }
        Relationships: []
      }
      catalog_filter_profiles: {
        Row: {
          exclude_hard: string[]
          exclude_soft: string[]
          include_keywords: string[]
          key: string
          min_price_usd: number | null
          mode: string
          updated_at: string | null
        }
        Insert: {
          exclude_hard?: string[]
          exclude_soft?: string[]
          include_keywords?: string[]
          key: string
          min_price_usd?: number | null
          mode?: string
          updated_at?: string | null
        }
        Update: {
          exclude_hard?: string[]
          exclude_soft?: string[]
          include_keywords?: string[]
          key?: string
          min_price_usd?: number | null
          mode?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_home_cache: {
        Row: {
          created_at: string
          env: string
          expires_at: string
          id: string
          items: Json
          meta: Json | null
        }
        Insert: {
          created_at?: string
          env: string
          expires_at: string
          id: string
          items?: Json
          meta?: Json | null
        }
        Update: {
          created_at?: string
          env?: string
          expires_at?: string
          id?: string
          items?: Json
          meta?: Json | null
        }
        Relationships: []
      }
      catalog_home_mobile_sections_cache: {
        Row: {
          built_at: string
          env: string
          payload: Json
          schema_version: number
          ttl_seconds: number
        }
        Insert: {
          built_at?: string
          env: string
          payload?: Json
          schema_version?: number
          ttl_seconds?: number
        }
        Update: {
          built_at?: string
          env?: string
          payload?: Json
          schema_version?: number
          ttl_seconds?: number
        }
        Relationships: []
      }
      catalog_item_media: {
        Row: {
          expires_at: string
          fetched_at: string
          image_count: number
          image_urls: Json
          provider: string
          provider_item_id: string
        }
        Insert: {
          expires_at: string
          fetched_at?: string
          image_count?: number
          image_urls?: Json
          provider: string
          provider_item_id: string
        }
        Update: {
          expires_at?: string
          fetched_at?: string
          image_count?: number
          image_urls?: Json
          provider?: string
          provider_item_id?: string
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          brand: string | null
          buying_options: string[] | null
          category_key: string | null
          condition: string | null
          currency: string | null
          data_hash: string | null
          data_updated_at: string | null
          expires_at: string | null
          fail_count: number | null
          first_seen_at: string | null
          id: string
          image_url: string | null
          images: Json | null
          in_stock: boolean | null
          is_active: boolean | null
          is_disallowed: boolean | null
          last_checked_at: string | null
          last_seen_at: string | null
          listing_type: string | null
          metadata: Json | null
          parts_subkey: string | null
          popularity_score: number | null
          price_updated_at: string | null
          price_usd: number | null
          product_url: string | null
          provider: string | null
          provider_product_id: string | null
          rating: number | null
          search_text: string | null
          status_reason: string | null
          tags: string[] | null
          title: string | null
          unified_category: string | null
          unified_subcategory: string | null
          updated_at: string | null
          vehicles_subkey: string | null
        }
        Insert: {
          brand?: string | null
          buying_options?: string[] | null
          category_key?: string | null
          condition?: string | null
          currency?: string | null
          data_hash?: string | null
          data_updated_at?: string | null
          expires_at?: string | null
          fail_count?: number | null
          first_seen_at?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          in_stock?: boolean | null
          is_active?: boolean | null
          is_disallowed?: boolean | null
          last_checked_at?: string | null
          last_seen_at?: string | null
          listing_type?: string | null
          metadata?: Json | null
          parts_subkey?: string | null
          popularity_score?: number | null
          price_updated_at?: string | null
          price_usd?: number | null
          product_url?: string | null
          provider?: string | null
          provider_product_id?: string | null
          rating?: number | null
          search_text?: string | null
          status_reason?: string | null
          tags?: string[] | null
          title?: string | null
          unified_category?: string | null
          unified_subcategory?: string | null
          updated_at?: string | null
          vehicles_subkey?: string | null
        }
        Update: {
          brand?: string | null
          buying_options?: string[] | null
          category_key?: string | null
          condition?: string | null
          currency?: string | null
          data_hash?: string | null
          data_updated_at?: string | null
          expires_at?: string | null
          fail_count?: number | null
          first_seen_at?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          in_stock?: boolean | null
          is_active?: boolean | null
          is_disallowed?: boolean | null
          last_checked_at?: string | null
          last_seen_at?: string | null
          listing_type?: string | null
          metadata?: Json | null
          parts_subkey?: string | null
          popularity_score?: number | null
          price_updated_at?: string | null
          price_usd?: number | null
          product_url?: string | null
          provider?: string | null
          provider_product_id?: string | null
          rating?: number | null
          search_text?: string | null
          status_reason?: string | null
          tags?: string[] | null
          title?: string | null
          unified_category?: string | null
          unified_subcategory?: string | null
          updated_at?: string | null
          vehicles_subkey?: string | null
        }
        Relationships: []
      }
      catalog_key_aliases: {
        Row: {
          alias: string
          canonical_key: string
          created_at: string | null
        }
        Insert: {
          alias: string
          canonical_key: string
          created_at?: string | null
        }
        Update: {
          alias?: string
          canonical_key?: string
          created_at?: string | null
        }
        Relationships: []
      }
      catalog_nav_settings: {
        Row: {
          drawer_order: Json
          home_sections: Json
          key: string
          updated_at: string
          version: number
        }
        Insert: {
          drawer_order?: Json
          home_sections?: Json
          key?: string
          updated_at?: string
          version?: number
        }
        Update: {
          drawer_order?: Json
          home_sections?: Json
          key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      catalog_nav_subtabs: {
        Row: {
          created_at: string
          ebay_category_hint: string | null
          ebay_category_id: string | null
          enabled: boolean
          id: string
          is_parts: boolean
          is_vehicle: boolean
          key: string
          min_price_usd: number | null
          order_index: number
          parent_key: string
          provider_mode: Json
          title_en: string
          title_fr: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ebay_category_hint?: string | null
          ebay_category_id?: string | null
          enabled?: boolean
          id?: string
          is_parts?: boolean
          is_vehicle?: boolean
          key: string
          min_price_usd?: number | null
          order_index?: number
          parent_key: string
          provider_mode?: Json
          title_en: string
          title_fr: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ebay_category_hint?: string | null
          ebay_category_id?: string | null
          enabled?: boolean
          id?: string
          is_parts?: boolean
          is_vehicle?: boolean
          key?: string
          min_price_usd?: number | null
          order_index?: number
          parent_key?: string
          provider_mode?: Json
          title_en?: string
          title_fr?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_nav_subtabs_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "catalog_nav_tabs"
            referencedColumns: ["key"]
          },
        ]
      }
      catalog_nav_tabs: {
        Row: {
          created_at: string
          ebay_category_id: string | null
          enabled: boolean
          icon: string | null
          key: string
          order_index: number
          title_en: string
          title_fr: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ebay_category_id?: string | null
          enabled?: boolean
          icon?: string | null
          key: string
          order_index?: number
          title_en: string
          title_fr: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ebay_category_id?: string | null
          enabled?: boolean
          icon?: string | null
          key?: string
          order_index?: number
          title_en?: string
          title_fr?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_products: {
        Row: {
          brand: string | null
          category_path: string[] | null
          created_at: string | null
          currency: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          in_stock: boolean | null
          price_usd: number | null
          product_url: string | null
          provider_id: string | null
          provider_product_id: string
          rating: number | null
          raw: Json | null
          review_count: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          category_path?: string[] | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean | null
          price_usd?: number | null
          product_url?: string | null
          provider_id?: string | null
          provider_product_id: string
          rating?: number | null
          raw?: Json | null
          review_count?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          category_path?: string[] | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean | null
          price_usd?: number | null
          product_url?: string | null
          provider_id?: string | null
          provider_product_id?: string
          rating?: number | null
          raw?: Json | null
          review_count?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "catalog_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_products_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "catalog_providers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_providers: {
        Row: {
          adapter_name: string | null
          capabilities: Json
          color_hex: string | null
          config: Json | null
          created_at: string | null
          display_name: string
          enabled: boolean | null
          environment: string | null
          id: string
          logo_url: string | null
          name: string
          priority: number | null
          rate_limit_per_minute: number | null
          requires_keys: Json
          secret_key_name: string | null
          updated_at: string | null
        }
        Insert: {
          adapter_name?: string | null
          capabilities?: Json
          color_hex?: string | null
          config?: Json | null
          created_at?: string | null
          display_name: string
          enabled?: boolean | null
          environment?: string | null
          id?: string
          logo_url?: string | null
          name: string
          priority?: number | null
          rate_limit_per_minute?: number | null
          requires_keys?: Json
          secret_key_name?: string | null
          updated_at?: string | null
        }
        Update: {
          adapter_name?: string | null
          capabilities?: Json
          color_hex?: string | null
          config?: Json | null
          created_at?: string | null
          display_name?: string
          enabled?: boolean | null
          environment?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          priority?: number | null
          rate_limit_per_minute?: number | null
          requires_keys?: Json
          secret_key_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      catalog_rate_limits: {
        Row: {
          count: number
          device_id: string
          endpoint: string
          window_start: string
        }
        Insert: {
          count?: number
          device_id: string
          endpoint: string
          window_start: string
        }
        Update: {
          count?: number
          device_id?: string
          endpoint?: string
          window_start?: string
        }
        Relationships: []
      }
      catalog_refresh_jobs: {
        Row: {
          created_at: string | null
          id: string
          last_error: string | null
          last_run: string | null
          slug: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_run?: string | null
          slug?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_run?: string | null
          slug?: string | null
          status?: string | null
        }
        Relationships: []
      }
      catalog_refresh_queue: {
        Row: {
          attempts: number | null
          category_key: string
          created_at: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          priority: number | null
          provider: string
          query: string
          scheduled_at: string | null
          status: string | null
        }
        Insert: {
          attempts?: number | null
          category_key: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          priority?: number | null
          provider: string
          query: string
          scheduled_at?: string | null
          status?: string | null
        }
        Update: {
          attempts?: number | null
          category_key?: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          priority?: number | null
          provider?: string
          query?: string
          scheduled_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      catalog_search_cache: {
        Row: {
          amazon_domain: string
          id: string
          page: number
          page_size: number
          provider: string
          query: string
          response: Json
          updated_at: string
        }
        Insert: {
          amazon_domain?: string
          id?: string
          page?: number
          page_size?: number
          provider?: string
          query: string
          response?: Json
          updated_at?: string
        }
        Update: {
          amazon_domain?: string
          id?: string
          page?: number
          page_size?: number
          provider?: string
          query?: string
          response?: Json
          updated_at?: string
        }
        Relationships: []
      }
      catalog_sections: {
        Row: {
          created_at: string
          ebay_category_id: string | null
          exclude_keywords: string[] | null
          include_keywords: string[] | null
          is_active: boolean
          key: string
          min_price_usd: number | null
          mode: string
          seed_query: string
          sort_order: number
          strict: boolean | null
          title_en: string
          title_fr: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ebay_category_id?: string | null
          exclude_keywords?: string[] | null
          include_keywords?: string[] | null
          is_active?: boolean
          key: string
          min_price_usd?: number | null
          mode: string
          seed_query: string
          sort_order?: number
          strict?: boolean | null
          title_en: string
          title_fr: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ebay_category_id?: string | null
          exclude_keywords?: string[] | null
          include_keywords?: string[] | null
          is_active?: boolean
          key?: string
          min_price_usd?: number | null
          mode?: string
          seed_query?: string
          sort_order?: number
          strict?: boolean | null
          title_en?: string
          title_fr?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_seed_queries: {
        Row: {
          category: string
          created_at: string | null
          ebay_category_id: string | null
          enabled: boolean | null
          filters: Json | null
          id: string
          item_count: number | null
          last_refreshed_at: string | null
          provider: string
          query: string | null
          seed_key: string
          ttl_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          ebay_category_id?: string | null
          enabled?: boolean | null
          filters?: Json | null
          id?: string
          item_count?: number | null
          last_refreshed_at?: string | null
          provider: string
          query?: string | null
          seed_key: string
          ttl_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          ebay_category_id?: string | null
          enabled?: boolean | null
          filters?: Json | null
          id?: string
          item_count?: number | null
          last_refreshed_at?: string | null
          provider?: string
          query?: string | null
          seed_key?: string
          ttl_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      chat_routing_config: {
        Row: {
          admin_email: string | null
          admin_name: string | null
          admin_user_id: string
          chats_assigned_count: number
          created_at: string
          id: string
          is_available: boolean
          last_assigned_at: string | null
          priority_order: number
          updated_at: string
        }
        Insert: {
          admin_email?: string | null
          admin_name?: string | null
          admin_user_id: string
          chats_assigned_count?: number
          created_at?: string
          id?: string
          is_available?: boolean
          last_assigned_at?: string | null
          priority_order?: number
          updated_at?: string
        }
        Update: {
          admin_email?: string | null
          admin_name?: string | null
          admin_user_id?: string
          chats_assigned_count?: number
          created_at?: string
          id?: string
          is_available?: boolean
          last_assigned_at?: string | null
          priority_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      checkout_funnel_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          metadata: Json | null
          order_id: string | null
          session_id: string | null
          status: string
          step: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          session_id?: string | null
          status?: string
          step: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          session_id?: string | null
          status?: string
          step?: string
          user_id?: string
        }
        Relationships: []
      }
      checkout_sessions: {
        Row: {
          cart_snapshot: Json
          created_at: string
          currency: string
          grand_total: number
          id: string
          integrity_hash: string
          maisha_reference: string | null
          metadata: Json | null
          order_id: string | null
          paid_at: string | null
          pay_method: string
          provider_triggered_at: string | null
          redirect_url: string | null
          selected_provider: string | null
          status: string
          totals_breakdown: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cart_snapshot?: Json
          created_at?: string
          currency?: string
          grand_total: number
          id?: string
          integrity_hash: string
          maisha_reference?: string | null
          metadata?: Json | null
          order_id?: string | null
          paid_at?: string | null
          pay_method?: string
          provider_triggered_at?: string | null
          redirect_url?: string | null
          selected_provider?: string | null
          status?: string
          totals_breakdown?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cart_snapshot?: Json
          created_at?: string
          currency?: string
          grand_total?: number
          id?: string
          integrity_hash?: string
          maisha_reference?: string | null
          metadata?: Json | null
          order_id?: string | null
          paid_at?: string | null
          pay_method?: string
          provider_triggered_at?: string | null
          redirect_url?: string | null
          selected_provider?: string | null
          status?: string
          totals_breakdown?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_email_logs: {
        Row: {
          body: string
          customer_email: string
          customer_id: string
          id: string
          sent_at: string
          sent_by: string
          status: string
          subject: string
        }
        Insert: {
          body: string
          customer_email: string
          customer_id: string
          id?: string
          sent_at?: string
          sent_by: string
          status?: string
          subject: string
        }
        Update: {
          body?: string
          customer_email?: string
          customer_id?: string
          id?: string
          sent_at?: string
          sent_by?: string
          status?: string
          subject?: string
        }
        Relationships: []
      }
      customer_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          customer_id: string
          id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          customer_id: string
          id?: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          customer_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "customer_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string | null
          device_token: string
          id: string
          last_used_at: string | null
          platform: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_token: string
          id?: string
          last_used_at?: string | null
          platform: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_token?: string
          id?: string
          last_used_at?: string | null
          platform?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ebay_category_cache: {
        Row: {
          category_id: string
          category_name: string | null
          category_tree_id: string | null
          expires_at: string
          hint: string
          marketplace_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          category_name?: string | null
          category_tree_id?: string | null
          expires_at?: string
          hint: string
          marketplace_id?: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          category_name?: string | null
          category_tree_id?: string | null
          expires_at?: string
          hint?: string
          marketplace_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      environments: {
        Row: {
          api_base_url: string | null
          catalog_enabled: boolean | null
          catalog_mode: string | null
          created_at: string | null
          id: string
          is_default: boolean | null
          min_app_version: string | null
          name: string
          ota_channel: string | null
          ota_enabled: boolean | null
          provider_secrets_prefix: string | null
          updated_at: string | null
        }
        Insert: {
          api_base_url?: string | null
          catalog_enabled?: boolean | null
          catalog_mode?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          min_app_version?: string | null
          name: string
          ota_channel?: string | null
          ota_enabled?: boolean | null
          provider_secrets_prefix?: string | null
          updated_at?: string | null
        }
        Update: {
          api_base_url?: string | null
          catalog_enabled?: boolean | null
          catalog_mode?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          min_app_version?: string | null
          name?: string
          ota_channel?: string | null
          ota_enabled?: boolean | null
          provider_secrets_prefix?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      faq_kb: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_active: boolean
          language: string
          priority: number
          question: string
          tags: string[]
          trigger_phrases: string[]
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          priority?: number
          question: string
          tags?: string[]
          trigger_phrases?: string[]
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          priority?: number
          question?: string
          tags?: string[]
          trigger_phrases?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          platform: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          platform?: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      guest_cart_snapshots: {
        Row: {
          cart_json: Json
          created_at: string
          device_id: string
          updated_at: string
        }
        Insert: {
          cart_json?: Json
          created_at?: string
          device_id: string
          updated_at?: string
        }
        Update: {
          cart_json?: Json
          created_at?: string
          device_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      home_cache_mobile_sections: {
        Row: {
          built_at: string
          env: string
          payload: Json
          schema_version: number
          ttl_seconds: number
        }
        Insert: {
          built_at?: string
          env: string
          payload: Json
          schema_version: number
          ttl_seconds: number
        }
        Update: {
          built_at?: string
          env?: string
          payload?: Json
          schema_version?: number
          ttl_seconds?: number
        }
        Relationships: []
      }
      home_cache_web_feed: {
        Row: {
          built_at: string
          env: string
          payload: Json
          schema_version: number
          ttl_seconds: number
        }
        Insert: {
          built_at?: string
          env: string
          payload: Json
          schema_version: number
          ttl_seconds: number
        }
        Update: {
          built_at?: string
          env?: string
          payload?: Json
          schema_version?: number
          ttl_seconds?: number
        }
        Relationships: []
      }
      home_recipe_seeds: {
        Row: {
          created_at: string
          enabled: boolean
          excluded_terms: string[]
          id: string
          max_items: number
          query: string
          recipe_id: string
          required_terms: string[]
          sort_order: number
          weight: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          excluded_terms?: string[]
          id?: string
          max_items?: number
          query: string
          recipe_id: string
          required_terms?: string[]
          sort_order?: number
          weight?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          excluded_terms?: string[]
          id?: string
          max_items?: number
          query?: string
          recipe_id?: string
          required_terms?: string[]
          sort_order?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "home_recipe_seeds_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "home_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      home_recipes: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          key: string
          max_price_usd: number | null
          min_price_usd: number | null
          mode: string
          provider_policy: Json
          sort_order: number
          target: string
          title_en: string | null
          title_fr: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          max_price_usd?: number | null
          min_price_usd?: number | null
          mode?: string
          provider_policy?: Json
          sort_order?: number
          target: string
          title_en?: string | null
          title_fr?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          max_price_usd?: number | null
          min_price_usd?: number | null
          mode?: string
          provider_policy?: Json
          sort_order?: number
          target?: string
          title_en?: string | null
          title_fr?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      home_refresh_settings: {
        Row: {
          env: string
          mobile_enabled: boolean
          mobile_refresh_hours: number
          mobile_schema_version: number
          updated_at: string
          web_enabled: boolean
          web_refresh_hours: number
          web_schema_version: number
        }
        Insert: {
          env: string
          mobile_enabled?: boolean
          mobile_refresh_hours?: number
          mobile_schema_version?: number
          updated_at?: string
          web_enabled?: boolean
          web_refresh_hours?: number
          web_schema_version?: number
        }
        Update: {
          env?: string
          mobile_enabled?: boolean
          mobile_refresh_hours?: number
          mobile_schema_version?: number
          updated_at?: string
          web_enabled?: boolean
          web_refresh_hours?: number
          web_schema_version?: number
        }
        Relationships: []
      }
      home_section_seeds: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          id: string
          query: string
          section_key: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          query: string
          section_key: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          query?: string
          section_key?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "home_section_seeds_section_key_fkey"
            columns: ["section_key"]
            isOneToOne: false
            referencedRelation: "home_sections"
            referencedColumns: ["key"]
          },
        ]
      }
      home_sections: {
        Row: {
          default_category_key: string | null
          ebay_category: string | null
          enabled: boolean | null
          exclude_keywords: string[] | null
          include_keywords: string[] | null
          is_vehicle: boolean | null
          key: string
          min_price: number | null
          see_all_query: string | null
          sort_order: number | null
          strict: boolean | null
          title_en: string
          title_fr: string
          updated_at: string | null
        }
        Insert: {
          default_category_key?: string | null
          ebay_category?: string | null
          enabled?: boolean | null
          exclude_keywords?: string[] | null
          include_keywords?: string[] | null
          is_vehicle?: boolean | null
          key: string
          min_price?: number | null
          see_all_query?: string | null
          sort_order?: number | null
          strict?: boolean | null
          title_en: string
          title_fr: string
          updated_at?: string | null
        }
        Update: {
          default_category_key?: string | null
          ebay_category?: string | null
          enabled?: boolean | null
          exclude_keywords?: string[] | null
          include_keywords?: string[] | null
          is_vehicle?: boolean | null
          key?: string
          min_price?: number | null
          see_all_query?: string | null
          sort_order?: number | null
          strict?: boolean | null
          title_en?: string
          title_fr?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      home_seed_suggestions: {
        Row: {
          approved: boolean | null
          created_at: string | null
          id: string
          query: string
          score: number | null
          section_key: string
          source: string
        }
        Insert: {
          approved?: boolean | null
          created_at?: string | null
          id?: string
          query: string
          score?: number | null
          section_key: string
          source?: string
        }
        Update: {
          approved?: boolean | null
          created_at?: string | null
          id?: string
          query?: string
          score?: number | null
          section_key?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_seed_suggestions_section_key_fkey"
            columns: ["section_key"]
            isOneToOne: false
            referencedRelation: "home_sections"
            referencedColumns: ["key"]
          },
        ]
      }
      home_seen_items: {
        Row: {
          id: string
          provider: string
          provider_item_id: string
          rotation_key: string
          section_key: string
          seen_at: string
        }
        Insert: {
          id?: string
          provider: string
          provider_item_id: string
          rotation_key: string
          section_key: string
          seen_at?: string
        }
        Update: {
          id?: string
          provider?: string
          provider_item_id?: string
          rotation_key?: string
          section_key?: string
          seen_at?: string
        }
        Relationships: []
      }
      homepage_pinned_items: {
        Row: {
          catalog_item_id: string
          category_key: string
          created_at: string | null
          id: string
          image_url: string | null
          pinned_by: string | null
          price_usd: number | null
          provider: string
          provider_product_id: string
          sort_order: number
          title: string | null
        }
        Insert: {
          catalog_item_id: string
          category_key: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          pinned_by?: string | null
          price_usd?: number | null
          provider?: string
          provider_product_id?: string
          sort_order?: number
          title?: string | null
        }
        Update: {
          catalog_item_id?: string
          category_key?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          pinned_by?: string | null
          price_usd?: number | null
          provider?: string
          provider_product_id?: string
          sort_order?: number
          title?: string | null
        }
        Relationships: []
      }
      hot_product_campaigns: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          products: Json
          sent_at: string | null
          sent_count: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          products?: Json
          sent_at?: string | null
          sent_count?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          products?: Json
          sent_at?: string | null
          sent_count?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      hot_products_showcase: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          markup_usd: number | null
          price_usd: number | null
          product_url: string | null
          provider: string | null
          provider_product_id: string | null
          shipping_usd: number | null
          sort_order: number | null
          title: string | null
          total_price_usd: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          markup_usd?: number | null
          price_usd?: number | null
          product_url?: string | null
          provider?: string | null
          provider_product_id?: string | null
          shipping_usd?: number | null
          sort_order?: number | null
          title?: string | null
          total_price_usd?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          markup_usd?: number | null
          price_usd?: number | null
          product_url?: string | null
          provider?: string | null
          provider_product_id?: string | null
          shipping_usd?: number | null
          sort_order?: number | null
          title?: string | null
          total_price_usd?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invitation_attempts: {
        Row: {
          attempted_at: string | null
          id: string
          ip_address: string
          success: boolean | null
          token_hash: string
        }
        Insert: {
          attempted_at?: string | null
          id?: string
          ip_address: string
          success?: boolean | null
          token_hash: string
        }
        Update: {
          attempted_at?: string | null
          id?: string
          ip_address?: string
          success?: boolean | null
          token_hash?: string
        }
        Relationships: []
      }
      knowledge_base_articles: {
        Row: {
          category: string
          content: string
          created_at: string
          created_by: string
          id: string
          published: boolean | null
          tags: string[] | null
          title: string
          updated_at: string
          view_count: number | null
        }
        Insert: {
          category: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          published?: boolean | null
          tags?: string[] | null
          title: string
          updated_at?: string
          view_count?: number | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          published?: boolean | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          view_count?: number | null
        }
        Relationships: []
      }
      maisha_payments: {
        Row: {
          amount_cdf: number | null
          amount_usd: number | null
          confirmation_code: string | null
          created_at: string
          currency: string | null
          id: string
          maisha_reference: string
          maishapay_description: string | null
          maishapay_operator_ref_id: string | null
          maishapay_status: string | null
          maishapay_transaction_ref_id: string | null
          order_id: string
          paid_at: string | null
          raw_query: Json | null
          raw_request: Json | null
          raw_response: Json | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cdf?: number | null
          amount_usd?: number | null
          confirmation_code?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          maisha_reference: string
          maishapay_description?: string | null
          maishapay_operator_ref_id?: string | null
          maishapay_status?: string | null
          maishapay_transaction_ref_id?: string | null
          order_id: string
          paid_at?: string | null
          raw_query?: Json | null
          raw_request?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cdf?: number | null
          amount_usd?: number | null
          confirmation_code?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          maisha_reference?: string
          maishapay_description?: string | null
          maishapay_operator_ref_id?: string | null
          maishapay_status?: string | null
          maishapay_transaction_ref_id?: string | null
          order_id?: string
          paid_at?: string | null
          raw_query?: Json | null
          raw_request?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maisha_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_transfer_proofs: {
        Row: {
          admin_notes: string | null
          created_at: string
          file_path: string
          id: string
          mime_type: string | null
          order_id: string
          original_filename: string | null
          reference: string
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string
          size_bytes: number | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          file_path: string
          id?: string
          mime_type?: string | null
          order_id: string
          original_filename?: string | null
          reference: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id: string
          size_bytes?: number | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          order_id?: string
          original_filename?: string | null
          reference?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string
          size_bytes?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_transfer_proofs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_proofs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "manual_transfer_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_transfer_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          order_id: string
          reference: string
          status: string
          upload_token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id: string
          reference: string
          status?: string
          upload_token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id?: string
          reference?: string
          status?: string
          upload_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_transfer_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      marketer_thresholds: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          last_notified_count: number | null
          marketer_name: string
          notified_at: string | null
          ref_code: string
          threshold_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_notified_count?: number | null
          marketer_name: string
          notified_at?: string | null
          ref_code: string
          threshold_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_notified_count?: number | null
          marketer_name?: string
          notified_at?: string | null
          ref_code?: string
          threshold_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      order_actions: {
        Row: {
          action_message: string | null
          action_type: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json | null
          order_id: string
        }
        Insert: {
          action_message?: string | null
          action_type: string
          actor_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id: string
        }
        Update: {
          action_message?: string | null
          action_type?: string
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_actions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          admin_adjusted_price: number | null
          base_price_usd: number | null
          canonical_url: string | null
          captured_price: number | null
          created_at: string
          device_id: string | null
          est_weight_kg: number | null
          id: string
          is_saved_for_later: boolean
          is_vehicle: boolean | null
          last_reminder_at: string | null
          markup_fee_usd: number | null
          notes: string | null
          order_id: string
          price_confirmation_id: string | null
          price_confirmation_status: string | null
          price_source: string | null
          product_image_url: string | null
          product_url: string
          provider_product_id: string | null
          quantity: number
          reminder_count: number | null
          requires_manual_quote: boolean | null
          saved_at: string | null
          shipping_fee_usd: number | null
          shipping_item_type_id: string | null
          shipping_status: string | null
          store: Database["public"]["Enums"]["store_type"]
          subtotal_usd: number | null
          title: string | null
          total_price_cdf: number | null
          total_price_usd: number | null
          unit_price_usd: number | null
          updated_at: string
          vehicle_quote_applied: boolean | null
        }
        Insert: {
          admin_adjusted_price?: number | null
          base_price_usd?: number | null
          canonical_url?: string | null
          captured_price?: number | null
          created_at?: string
          device_id?: string | null
          est_weight_kg?: number | null
          id?: string
          is_saved_for_later?: boolean
          is_vehicle?: boolean | null
          last_reminder_at?: string | null
          markup_fee_usd?: number | null
          notes?: string | null
          order_id: string
          price_confirmation_id?: string | null
          price_confirmation_status?: string | null
          price_source?: string | null
          product_image_url?: string | null
          product_url: string
          provider_product_id?: string | null
          quantity?: number
          reminder_count?: number | null
          requires_manual_quote?: boolean | null
          saved_at?: string | null
          shipping_fee_usd?: number | null
          shipping_item_type_id?: string | null
          shipping_status?: string | null
          store: Database["public"]["Enums"]["store_type"]
          subtotal_usd?: number | null
          title?: string | null
          total_price_cdf?: number | null
          total_price_usd?: number | null
          unit_price_usd?: number | null
          updated_at?: string
          vehicle_quote_applied?: boolean | null
        }
        Update: {
          admin_adjusted_price?: number | null
          base_price_usd?: number | null
          canonical_url?: string | null
          captured_price?: number | null
          created_at?: string
          device_id?: string | null
          est_weight_kg?: number | null
          id?: string
          is_saved_for_later?: boolean
          is_vehicle?: boolean | null
          last_reminder_at?: string | null
          markup_fee_usd?: number | null
          notes?: string | null
          order_id?: string
          price_confirmation_id?: string | null
          price_confirmation_status?: string | null
          price_source?: string | null
          product_image_url?: string | null
          product_url?: string
          provider_product_id?: string | null
          quantity?: number
          reminder_count?: number | null
          requires_manual_quote?: boolean | null
          saved_at?: string | null
          shipping_fee_usd?: number | null
          shipping_item_type_id?: string | null
          shipping_status?: string | null
          store?: Database["public"]["Enums"]["store_type"]
          subtotal_usd?: number | null
          title?: string | null
          total_price_cdf?: number | null
          total_price_usd?: number | null
          unit_price_usd?: number | null
          updated_at?: string
          vehicle_quote_applied?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_price_confirmation_id_fkey"
            columns: ["price_confirmation_id"]
            isOneToOne: false
            referencedRelation: "price_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_shipping_item_type_id_fkey"
            columns: ["shipping_item_type_id"]
            isOneToOne: false
            referencedRelation: "shipping_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          actual_shipping_cost_usd: number | null
          admin_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancel_reason: string | null
          carrier: string | null
          cart_reminder_2_sent_at: string | null
          cart_reminder_sent_at: string | null
          cart_version: number
          contains_vehicle: boolean | null
          created_at: string
          delivered_at: string | null
          estimated_delivery: string | null
          exchange_rate_used: number | null
          id: string
          info_requested: boolean | null
          item_total_usd: number | null
          maisha_description: string | null
          maisha_payment_status: string | null
          maisha_status_code: string | null
          maisha_transaction_id: string | null
          normalized_amount: number | null
          normalized_currency: string | null
          operator_ref_id: string | null
          payment_confirmation_email_sent_at: string | null
          payment_notes: string | null
          payment_verification_method: string | null
          payment_verified_at: string | null
          payment_verified_by: string | null
          refund_amount_usd: number | null
          refund_issued_at: string | null
          refund_issued_by: string | null
          refund_reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requires_manual_quote: boolean | null
          service_fee_usd: number | null
          shipped_at: string | null
          shipping_city: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd: number | null
          status: Database["public"]["Enums"]["order_status"]
          total_cdf: number | null
          total_usd: number | null
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_shipping_cost_usd?: number | null
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          carrier?: string | null
          cart_reminder_2_sent_at?: string | null
          cart_reminder_sent_at?: string | null
          cart_version?: number
          contains_vehicle?: boolean | null
          created_at?: string
          delivered_at?: string | null
          estimated_delivery?: string | null
          exchange_rate_used?: number | null
          id?: string
          info_requested?: boolean | null
          item_total_usd?: number | null
          maisha_description?: string | null
          maisha_payment_status?: string | null
          maisha_status_code?: string | null
          maisha_transaction_id?: string | null
          normalized_amount?: number | null
          normalized_currency?: string | null
          operator_ref_id?: string | null
          payment_confirmation_email_sent_at?: string | null
          payment_notes?: string | null
          payment_verification_method?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
          refund_amount_usd?: number | null
          refund_issued_at?: string | null
          refund_issued_by?: string | null
          refund_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requires_manual_quote?: boolean | null
          service_fee_usd?: number | null
          shipped_at?: string | null
          shipping_city?: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          total_cdf?: number | null
          total_usd?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_shipping_cost_usd?: number | null
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          carrier?: string | null
          cart_reminder_2_sent_at?: string | null
          cart_reminder_sent_at?: string | null
          cart_version?: number
          contains_vehicle?: boolean | null
          created_at?: string
          delivered_at?: string | null
          estimated_delivery?: string | null
          exchange_rate_used?: number | null
          id?: string
          info_requested?: boolean | null
          item_total_usd?: number | null
          maisha_description?: string | null
          maisha_payment_status?: string | null
          maisha_status_code?: string | null
          maisha_transaction_id?: string | null
          normalized_amount?: number | null
          normalized_currency?: string | null
          operator_ref_id?: string | null
          payment_confirmation_email_sent_at?: string | null
          payment_notes?: string | null
          payment_verification_method?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
          refund_amount_usd?: number | null
          refund_issued_at?: string | null
          refund_issued_by?: string | null
          refund_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requires_manual_quote?: boolean | null
          service_fee_usd?: number | null
          shipped_at?: string | null
          shipping_city?: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          total_cdf?: number | null
          total_usd?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount: number
          attempt_count: number
          cart_hash: string
          checkout_session_id: string | null
          created_at: string
          currency: string
          expires_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          order_id: string | null
          payment_method: string | null
          provider: string | null
          provider_ref: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          attempt_count?: number
          cart_hash: string
          checkout_session_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          order_id?: string | null
          payment_method?: string | null
          provider?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          attempt_count?: number
          cart_hash?: string
          checkout_session_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          order_id?: string | null
          payment_method?: string | null
          provider?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string | null
          event_id: string | null
          event_type: string
          id: string
          payload: Json
          payment_id: string | null
          provider_key: string
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          event_type: string
          id?: string
          payload: Json
          payment_id?: string | null
          provider_key: string
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          provider_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "safe_user_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          order_id: string
          status: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          order_id: string
          status?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          order_id?: string
          status?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          config_public: Json | null
          created_at: string | null
          display_name: string
          id: string
          is_default: boolean
          is_enabled: boolean
          priority: number
          provider_key: string
          secret_refs: Json | null
          supported_countries: string[] | null
          supported_methods: string[] | null
          updated_at: string | null
        }
        Insert: {
          config_public?: Json | null
          created_at?: string | null
          display_name: string
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          priority?: number
          provider_key: string
          secret_refs?: Json | null
          supported_countries?: string[] | null
          supported_methods?: string[] | null
          updated_at?: string | null
        }
        Update: {
          config_public?: Json | null
          created_at?: string | null
          display_name?: string
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          priority?: number
          provider_key?: string
          secret_refs?: Json | null
          supported_countries?: string[] | null
          supported_methods?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_settings: {
        Row: {
          bank_transfer_enabled: boolean
          id: string
          large_order_currency: string
          mobile_money_max_cdf: number
          mobile_money_max_usd: number
          pawapay_enabled: boolean
          stripe_enabled: boolean
          updated_at: string
        }
        Insert: {
          bank_transfer_enabled?: boolean
          id?: string
          large_order_currency?: string
          mobile_money_max_cdf?: number
          mobile_money_max_usd?: number
          pawapay_enabled?: boolean
          stripe_enabled?: boolean
          updated_at?: string
        }
        Update: {
          bank_transfer_enabled?: boolean
          id?: string
          large_order_currency?: string
          mobile_money_max_cdf?: number
          mobile_money_max_usd?: number
          pawapay_enabled?: boolean
          stripe_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_secret: string | null
          country: string | null
          created_at: string | null
          currency: string
          customer_phone: string | null
          id: string
          order_id: string
          paid_at: string | null
          provider_deposit_id: string | null
          provider_key: string
          provider_transaction_id: string | null
          raw_events: Json | null
          raw_request: Json | null
          reference: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          client_secret?: string | null
          country?: string | null
          created_at?: string | null
          currency: string
          customer_phone?: string | null
          id?: string
          order_id: string
          paid_at?: string | null
          provider_deposit_id?: string | null
          provider_key: string
          provider_transaction_id?: string | null
          raw_events?: Json | null
          raw_request?: Json | null
          reference: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          client_secret?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string
          customer_phone?: string | null
          id?: string
          order_id?: string
          paid_at?: string | null
          provider_deposit_id?: string | null
          provider_key?: string
          provider_transaction_id?: string | null
          raw_events?: Json | null
          raw_request?: Json | null
          reference?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_metrics: {
        Row: {
          created_at: string | null
          duration_ms: number
          function_name: string
          id: string
          metadata: Json | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          duration_ms: number
          function_name: string
          id?: string
          metadata?: Json | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          duration_ms?: number
          function_name?: string
          id?: string
          metadata?: Json | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      prewarm_jobs: {
        Row: {
          amazon_fetched: number | null
          completed_at: string | null
          created_at: string | null
          current_section: string | null
          ebay_fetched: number | null
          error_message: string | null
          id: string
          last_heartbeat: string | null
          mixed_total: number | null
          rotation_key: string | null
          sections_completed: number | null
          sections_total: number | null
          started_at: string | null
          status: string
        }
        Insert: {
          amazon_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          current_section?: string | null
          ebay_fetched?: number | null
          error_message?: string | null
          id?: string
          last_heartbeat?: string | null
          mixed_total?: number | null
          rotation_key?: string | null
          sections_completed?: number | null
          sections_total?: number | null
          started_at?: string | null
          status?: string
        }
        Update: {
          amazon_fetched?: number | null
          completed_at?: string | null
          created_at?: string | null
          current_section?: string | null
          ebay_fetched?: number | null
          error_message?: string | null
          id?: string
          last_heartbeat?: string | null
          mixed_total?: number | null
          rotation_key?: string | null
          sections_completed?: number | null
          sections_total?: number | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      price_cache: {
        Row: {
          base_price: number
          currency: string | null
          currency_symbol: string | null
          display_price: string | null
          expires_at: string
          fetched_at: string
          id: string
          image_url: string | null
          raw_currency_code: string | null
          store: string
          title: string | null
          url: string
        }
        Insert: {
          base_price: number
          currency?: string | null
          currency_symbol?: string | null
          display_price?: string | null
          expires_at?: string
          fetched_at?: string
          id?: string
          image_url?: string | null
          raw_currency_code?: string | null
          store?: string
          title?: string | null
          url: string
        }
        Update: {
          base_price?: number
          currency?: string | null
          currency_symbol?: string | null
          display_price?: string | null
          expires_at?: string
          fetched_at?: string
          id?: string
          image_url?: string | null
          raw_currency_code?: string | null
          store?: string
          title?: string | null
          url?: string
        }
        Relationships: []
      }
      price_capture_cache: {
        Row: {
          canonical_url: string | null
          capture_count: number
          captured_at: string
          confidence: number
          currency: string
          expires_at: string
          id: string
          last_seen_at: string
          price_value: number
          product_key: string
          source: string
          store: string
          title: string | null
        }
        Insert: {
          canonical_url?: string | null
          capture_count?: number
          captured_at?: string
          confidence?: number
          currency?: string
          expires_at: string
          id?: string
          last_seen_at?: string
          price_value: number
          product_key: string
          source: string
          store: string
          title?: string | null
        }
        Update: {
          canonical_url?: string | null
          capture_count?: number
          captured_at?: string
          confidence?: number
          currency?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          price_value?: number
          product_key?: string
          source?: string
          store?: string
          title?: string | null
        }
        Relationships: []
      }
      price_confirmations: {
        Row: {
          admin_currency: string | null
          admin_note: string | null
          admin_price: number | null
          cart_item_id: string | null
          created_at: string
          device_id: string | null
          extracted_currency: string | null
          extracted_price: number | null
          extraction_confidence: number | null
          extraction_source: string | null
          id: string
          product_url: string
          proposed_currency: string
          proposed_price: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store: string
          updated_at: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          admin_currency?: string | null
          admin_note?: string | null
          admin_price?: number | null
          cart_item_id?: string | null
          created_at?: string
          device_id?: string | null
          extracted_currency?: string | null
          extracted_price?: number | null
          extraction_confidence?: number | null
          extraction_source?: string | null
          id?: string
          product_url: string
          proposed_currency: string
          proposed_price: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store: string
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          admin_currency?: string | null
          admin_note?: string | null
          admin_price?: number | null
          cart_item_id?: string | null
          created_at?: string
          device_id?: string | null
          extracted_currency?: string | null
          extracted_price?: number | null
          extraction_confidence?: number | null
          extraction_source?: string | null
          id?: string
          product_url?: string
          proposed_currency?: string
          proposed_price?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store?: string
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      price_history: {
        Row: {
          canonical_url: string | null
          captured_at: string
          change_type: string
          confidence: number
          currency: string
          id: string
          prev_currency: string | null
          prev_price_value: number | null
          price_value: number
          product_key: string
          source: string
          store: string
          title: string | null
        }
        Insert: {
          canonical_url?: string | null
          captured_at?: string
          change_type?: string
          confidence?: number
          currency?: string
          id?: string
          prev_currency?: string | null
          prev_price_value?: number | null
          price_value: number
          product_key: string
          source: string
          store: string
          title?: string | null
        }
        Update: {
          canonical_url?: string | null
          captured_at?: string
          change_type?: string
          confidence?: number
          currency?: string
          id?: string
          prev_currency?: string | null
          prev_price_value?: number | null
          price_value?: number
          product_key?: string
          source?: string
          store?: string
          title?: string | null
        }
        Relationships: []
      }
      product_cache: {
        Row: {
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          last_scrape_at: string | null
          last_scrape_error: string | null
          last_scrape_status: string | null
          price: number | null
          product_url: string
          scrape_attempt_count: number | null
          source: string | null
          store: string | null
          title: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          last_scrape_at?: string | null
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          price?: number | null
          product_url: string
          scrape_attempt_count?: number | null
          source?: string | null
          store?: string | null
          title?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          last_scrape_at?: string | null
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          price?: number | null
          product_url?: string
          scrape_attempt_count?: number | null
          source?: string | null
          store?: string | null
          title?: string | null
        }
        Relationships: []
      }
      product_hot_cache: {
        Row: {
          created_at: string | null
          expires_at: string
          hit_count: number | null
          id: string
          response_json: Json
          store: string
          url: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          hit_count?: number | null
          id?: string
          response_json: Json
          store?: string
          url: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          hit_count?: number | null
          id?: string
          response_json?: Json
          store?: string
          url?: string
        }
        Relationships: []
      }
      product_popularity_events: {
        Row: {
          created_at: string
          delta: number
          id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          delta?: number
          id?: string
          product_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          product_id?: string
        }
        Relationships: []
      }
      product_recommendations: {
        Row: {
          context: string
          created_at: string | null
          expires_at: string | null
          id: string
          recommendations: Json
          user_id: string
        }
        Insert: {
          context: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          recommendations: Json
          user_id: string
        }
        Update: {
          context?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          recommendations?: Json
          user_id?: string
        }
        Relationships: []
      }
      product_variants_cache: {
        Row: {
          expires_at: string
          product_id: string
          source: string
          updated_at: string
          variants_json: Json
        }
        Insert: {
          expires_at: string
          product_id: string
          source: string
          updated_at?: string
          variants_json?: Json
        }
        Update: {
          expires_at?: string
          product_id?: string
          source?: string
          updated_at?: string
          variants_json?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string | null
          last_active_platform: string | null
          name: string | null
          phone: string | null
          postal_code: string | null
          province: string | null
          referred_by_code: string | null
          signup_platform: string | null
          state_province: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string | null
          last_active_platform?: string | null
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          referred_by_code?: string | null
          signup_platform?: string | null
          state_province?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string | null
          last_active_platform?: string | null
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          referred_by_code?: string | null
          signup_platform?: string | null
          state_province?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_budget: {
        Row: {
          call_count: number
          id: string
          limit_count: number
          provider: string
          updated_at: string
          window_key: string
          window_start: string
          window_type: string
        }
        Insert: {
          call_count?: number
          id?: string
          limit_count?: number
          provider: string
          updated_at?: string
          window_key: string
          window_start: string
          window_type: string
        }
        Update: {
          call_count?: number
          id?: string
          limit_count?: number
          provider?: string
          updated_at?: string
          window_key?: string
          window_start?: string
          window_type?: string
        }
        Relationships: []
      }
      provider_health_status: {
        Row: {
          consecutive_failures: number
          healthy: boolean
          provider: string
          reason: string | null
          unhealthy_until: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          healthy?: boolean
          provider: string
          reason?: string | null
          unhealthy_until?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          healthy?: boolean
          provider?: string
          reason?: string | null
          unhealthy_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      provider_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: string
          provider: string
          scopes: string[] | null
          token_type: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at: string
          provider: string
          scopes?: string[] | null
          token_type?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: string
          provider?: string
          scopes?: string[] | null
          token_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      query_translation_cache: {
        Row: {
          created_at: string
          expires_at: string
          hit_count: number
          normalized_query: string
          provider: string
          source_lang: string
          target_lang: string
          translated_query: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          hit_count?: number
          normalized_query: string
          provider?: string
          source_lang?: string
          target_lang?: string
          translated_query: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          hit_count?: number
          normalized_query?: string
          provider?: string
          source_lang?: string
          target_lang?: string
          translated_query?: string
        }
        Relationships: []
      }
      quote_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          customer_email: string | null
          id: string
          locale: string | null
          order_item_id: string
          product_url: string | null
          quoted_at: string | null
          quoted_by: string | null
          quoted_shipping_usd: number | null
          quoted_total_usd: number | null
          status: string
          store_name: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          customer_email?: string | null
          id?: string
          locale?: string | null
          order_item_id: string
          product_url?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          quoted_shipping_usd?: number | null
          quoted_total_usd?: number | null
          status?: string
          store_name?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          customer_email?: string | null
          id?: string
          locale?: string | null
          order_item_id?: string
          product_url?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          quoted_shipping_usd?: number | null
          quoted_total_usd?: number | null
          status?: string
          store_name?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          expires_at: string
          id: string
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          expires_at?: string
          id?: string
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          expires_at?: string
          id?: string
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      recently_viewed_items: {
        Row: {
          created_at: string
          device_id: string
          id: string
          image_url: string | null
          last_viewed_at: string
          product_url: string
          store_id: string
          title: string | null
          updated_at: string
          user_id: string | null
          view_count: number
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          image_url?: string | null
          last_viewed_at?: string
          product_url: string
          store_id: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          view_count?: number
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          image_url?: string | null
          last_viewed_at?: string
          product_url?: string
          store_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          view_count?: number
        }
        Relationships: []
      }
      recommendation_clicks: {
        Row: {
          clicked_at: string | null
          converted: boolean | null
          id: string
          product_url: string
          recommendation_id: string | null
          user_id: string
        }
        Insert: {
          clicked_at?: string | null
          converted?: boolean | null
          id?: string
          product_url: string
          recommendation_id?: string | null
          user_id: string
        }
        Update: {
          clicked_at?: string | null
          converted?: boolean | null
          id?: string
          product_url?: string
          recommendation_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_clicks_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "product_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_commissions: {
        Row: {
          buyer_user_id: string
          commission_amount_usd: number
          commission_percent: number
          created_at: string
          id: string
          order_id: string
          order_total_usd: number
          paid_at: string | null
          referrer_id: string
          status: string
        }
        Insert: {
          buyer_user_id: string
          commission_amount_usd?: number
          commission_percent?: number
          created_at?: string
          id?: string
          order_id: string
          order_total_usd?: number
          paid_at?: string | null
          referrer_id: string
          status?: string
        }
        Update: {
          buyer_user_id?: string
          commission_amount_usd?: number
          commission_percent?: number
          created_at?: string
          id?: string
          order_id?: string
          order_total_usd?: number
          paid_at?: string | null
          referrer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "referrers"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_events: {
        Row: {
          anon_session_id: string | null
          created_at: string
          event_type: string
          id: string
          meta: Json | null
          metadata: Json | null
          ref_code: string
          referred_user_id: string | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          anon_session_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          meta?: Json | null
          metadata?: Json | null
          ref_code: string
          referred_user_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          anon_session_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          meta?: Json | null
          metadata?: Json | null
          ref_code?: string
          referred_user_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      referral_payout_claims: {
        Row: {
          created_at: string
          delivery_error: string | null
          delivery_status: string | null
          delivery_tx_id: string | null
          id: string
          paid_at: string | null
          payout_amount_usd: number
          ref_code: string
          referrer_id: string
          rule_id: string
          status: string
          verified_count_at_trigger: number
        }
        Insert: {
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string | null
          delivery_tx_id?: string | null
          id?: string
          paid_at?: string | null
          payout_amount_usd: number
          ref_code: string
          referrer_id: string
          rule_id: string
          status?: string
          verified_count_at_trigger: number
        }
        Update: {
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string | null
          delivery_tx_id?: string | null
          id?: string
          paid_at?: string | null
          payout_amount_usd?: number
          ref_code?: string
          referrer_id?: string
          rule_id?: string
          status?: string
          verified_count_at_trigger?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_payout_claims_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "referrers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_payout_claims_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "referral_payout_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_payout_rules: {
        Row: {
          airtime_amount: number | null
          created_at: string
          data_mb: number | null
          id: string
          is_enabled: boolean
          operator_country_code: string
          payout_amount_usd: number
          reward_type: string
          threshold_verified_count: number
          updated_at: string
        }
        Insert: {
          airtime_amount?: number | null
          created_at?: string
          data_mb?: number | null
          id?: string
          is_enabled?: boolean
          operator_country_code?: string
          payout_amount_usd: number
          reward_type?: string
          threshold_verified_count: number
          updated_at?: string
        }
        Update: {
          airtime_amount?: number | null
          created_at?: string
          data_mb?: number | null
          id?: string
          is_enabled?: boolean
          operator_country_code?: string
          payout_amount_usd?: number
          reward_type?: string
          threshold_verified_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          amount_usd: number | null
          created_at: string
          id: string
          paid_at: string | null
          paid_by: string | null
          ref_code: string
          referred_user_id: string
          referrer_id: string | null
          referrer_user_id: string
          reward_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_usd?: number | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          ref_code: string
          referred_user_id: string
          referrer_id?: string | null
          referrer_user_id: string
          reward_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_usd?: number | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          ref_code?: string
          referred_user_id?: string
          referrer_id?: string | null
          referrer_user_id?: string
          reward_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "referrers"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_topup_log: {
        Row: {
          amount: number | null
          claim_id: string | null
          country_code: string | null
          created_at: string
          data_mb: number | null
          error_message: string | null
          id: string
          operator_id: string | null
          operator_name: string | null
          phone: string
          raw_response: Json | null
          referrer_id: string
          reloadly_tx_id: string | null
          status: string
          topup_type: string
        }
        Insert: {
          amount?: number | null
          claim_id?: string | null
          country_code?: string | null
          created_at?: string
          data_mb?: number | null
          error_message?: string | null
          id?: string
          operator_id?: string | null
          operator_name?: string | null
          phone: string
          raw_response?: Json | null
          referrer_id: string
          reloadly_tx_id?: string | null
          status?: string
          topup_type?: string
        }
        Update: {
          amount?: number | null
          claim_id?: string | null
          country_code?: string | null
          created_at?: string
          data_mb?: number | null
          error_message?: string | null
          id?: string
          operator_id?: string | null
          operator_name?: string | null
          phone?: string
          raw_response?: Json | null
          referrer_id?: string
          reloadly_tx_id?: string | null
          status?: string
          topup_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_topup_log_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "referral_payout_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      referrers: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          ref_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone: string
          ref_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
          ref_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      scrape_retry_queue: {
        Row: {
          attempt_count: number | null
          created_at: string | null
          failure_reason: string | null
          id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          product_url: string
          store: string | null
        }
        Insert: {
          attempt_count?: number | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          product_url: string
          store?: string | null
        }
        Update: {
          attempt_count?: number | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          product_url?: string
          store?: string | null
        }
        Relationships: []
      }
      search_normalization_logs: {
        Row: {
          ai_translation_used: boolean
          created_at: string
          detected_language: string
          dynamic_fallback_used: boolean
          expansions: string[]
          id: string
          normalized_query: string
          raw_query: string
          request_id: string | null
          result_count: number
          static_map_matched: boolean
        }
        Insert: {
          ai_translation_used?: boolean
          created_at?: string
          detected_language?: string
          dynamic_fallback_used?: boolean
          expansions?: string[]
          id?: string
          normalized_query: string
          raw_query: string
          request_id?: string | null
          result_count?: number
          static_map_matched?: boolean
        }
        Update: {
          ai_translation_used?: boolean
          created_at?: string
          detected_language?: string
          dynamic_fallback_used?: boolean
          expansions?: string[]
          id?: string
          normalized_query?: string
          raw_query?: string
          request_id?: string | null
          result_count?: number
          static_map_matched?: boolean
        }
        Relationships: []
      }
      search_proxy_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          payload: Json
          source: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          payload: Json
          source: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      search_query_expansions: {
        Row: {
          category_hint: string | null
          confidence: number | null
          created_at: string
          expanded_terms: string[]
          expires_at: string
          id: string
          query_normalized: string
          source_lang: string
        }
        Insert: {
          category_hint?: string | null
          confidence?: number | null
          created_at?: string
          expanded_terms?: string[]
          expires_at?: string
          id?: string
          query_normalized: string
          source_lang?: string
        }
        Update: {
          category_hint?: string | null
          confidence?: number | null
          created_at?: string
          expanded_terms?: string[]
          expires_at?: string
          id?: string
          query_normalized?: string
          source_lang?: string
        }
        Relationships: []
      }
      search_query_log: {
        Row: {
          auto_cached_count: number | null
          category_guess: string | null
          created_at: string
          db_count: number | null
          duration_ms: number | null
          expansion_used: boolean | null
          fuzzy_used: boolean | null
          id: string
          live_count: number | null
          q_norm: string
          q_original: string | null
          used_live: boolean | null
        }
        Insert: {
          auto_cached_count?: number | null
          category_guess?: string | null
          created_at?: string
          db_count?: number | null
          duration_ms?: number | null
          expansion_used?: boolean | null
          fuzzy_used?: boolean | null
          id?: string
          live_count?: number | null
          q_norm: string
          q_original?: string | null
          used_live?: boolean | null
        }
        Update: {
          auto_cached_count?: number | null
          category_guess?: string | null
          created_at?: string
          db_count?: number | null
          duration_ms?: number | null
          expansion_used?: boolean | null
          fuzzy_used?: boolean | null
          id?: string
          live_count?: number | null
          q_norm?: string
          q_original?: string | null
          used_live?: boolean | null
        }
        Relationships: []
      }
      search_relevancy_report_rows: {
        Row: {
          category: string | null
          created_at: string
          debug: Json | null
          fail_reasons: string[] | null
          id: string
          latency_ms: number
          missing_image_count: number
          parts_bleed_rate: number | null
          provider_amazon_count: number
          provider_ebay_count: number
          query: string
          report_id: string
          returned_count: number
          sample_top3_titles: string[] | null
          top12_relevant: number
          top3_relevant: number
          zero_price_count: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          debug?: Json | null
          fail_reasons?: string[] | null
          id?: string
          latency_ms?: number
          missing_image_count?: number
          parts_bleed_rate?: number | null
          provider_amazon_count?: number
          provider_ebay_count?: number
          query: string
          report_id: string
          returned_count?: number
          sample_top3_titles?: string[] | null
          top12_relevant?: number
          top3_relevant?: number
          zero_price_count?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          debug?: Json | null
          fail_reasons?: string[] | null
          id?: string
          latency_ms?: number
          missing_image_count?: number
          parts_bleed_rate?: number | null
          provider_amazon_count?: number
          provider_ebay_count?: number
          query?: string
          report_id?: string
          returned_count?: number
          sample_top3_titles?: string[] | null
          top12_relevant?: number
          top3_relevant?: number
          zero_price_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_relevancy_report_rows_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "search_relevancy_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      search_relevancy_reports: {
        Row: {
          avg_latency_ms: number
          created_at: string
          env: string
          fail_count: number
          id: string
          pass_count: number
          slow_count: number
          total_queries: number
        }
        Insert: {
          avg_latency_ms?: number
          created_at?: string
          env?: string
          fail_count?: number
          id?: string
          pass_count?: number
          slow_count?: number
          total_queries?: number
        }
        Update: {
          avg_latency_ms?: number
          created_at?: string
          env?: string
          fail_count?: number
          id?: string
          pass_count?: number
          slow_count?: number
          total_queries?: number
        }
        Relationships: []
      }
      search_rewrite_cache: {
        Row: {
          category_hint: string | null
          created_at: string
          expires_at: string
          id: string
          lang: string
          payload: Json
          q_norm: string
        }
        Insert: {
          category_hint?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          lang?: string
          payload?: Json
          q_norm: string
        }
        Update: {
          category_hint?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          lang?: string
          payload?: Json
          q_norm?: string
        }
        Relationships: []
      }
      search_rewrites: {
        Row: {
          category_key: string | null
          created_at: string
          enabled: boolean
          id: string
          lang: string
          notes: string | null
          pattern: string
          priority: number
          rewrite: string
          updated_at: string
        }
        Insert: {
          category_key?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          lang?: string
          notes?: string | null
          pattern: string
          priority?: number
          rewrite: string
          updated_at?: string
        }
        Update: {
          category_key?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          lang?: string
          notes?: string | null
          pattern?: string
          priority?: number
          rewrite?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_address: string | null
          bank_iban: string | null
          bank_instructions_en: string | null
          bank_instructions_fr: string | null
          bank_name: string | null
          bank_swift: string | null
          category_markups: Json | null
          created_at: string
          discount_codes: Json | null
          exchange_rate_usd_to_cdf: number
          extra_fees: Json | null
          global_markup_percent: number | null
          id: string
          maishapay_max_cdf: number | null
          maishapay_max_usd: number | null
          markup_percent: number | null
          min_service_fee_usd: number | null
          service_fee_percent: number
          shipping_base_fee_usd: number
          shipping_percent: number
          support_email: string | null
          support_whatsapp: string | null
          updated_at: string
        }
        Insert: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_address?: string | null
          bank_iban?: string | null
          bank_instructions_en?: string | null
          bank_instructions_fr?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          category_markups?: Json | null
          created_at?: string
          discount_codes?: Json | null
          exchange_rate_usd_to_cdf?: number
          extra_fees?: Json | null
          global_markup_percent?: number | null
          id?: string
          maishapay_max_cdf?: number | null
          maishapay_max_usd?: number | null
          markup_percent?: number | null
          min_service_fee_usd?: number | null
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
          support_email?: string | null
          support_whatsapp?: string | null
          updated_at?: string
        }
        Update: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_address?: string | null
          bank_iban?: string | null
          bank_instructions_en?: string | null
          bank_instructions_fr?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          category_markups?: Json | null
          created_at?: string
          discount_codes?: Json | null
          exchange_rate_usd_to_cdf?: number
          extra_fees?: Json | null
          global_markup_percent?: number | null
          id?: string
          maishapay_max_cdf?: number | null
          maishapay_max_usd?: number | null
          markup_percent?: number | null
          min_service_fee_usd?: number | null
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
          support_email?: string | null
          support_whatsapp?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shipping_item_types: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          est_weight_kg: number
          id: string
          key: string
          label: string
          requires_manual_quote: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          est_weight_kg: number
          id?: string
          key: string
          label: string
          requires_manual_quote?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          est_weight_kg?: number
          id?: string
          key?: string
          label?: string
          requires_manual_quote?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      store_visit_counts: {
        Row: {
          created_at: string
          device_id: string
          id: string
          last_visited_at: string
          store_id: string
          updated_at: string
          user_id: string | null
          visit_count: number
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          last_visited_at?: string
          store_id: string
          updated_at?: string
          user_id?: string | null
          visit_count?: number
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          last_visited_at?: string
          store_id?: string
          updated_at?: string
          user_id?: string | null
          visit_count?: number
        }
        Relationships: []
      }
      support_agents: {
        Row: {
          created_at: string
          id: string
          is_online: boolean
          languages: string[]
          notify_email: string | null
          notify_push_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_online?: boolean
          languages?: string[]
          notify_email?: string | null
          notify_push_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_online?: boolean
          languages?: string[]
          notify_email?: string | null
          notify_push_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          id: string
          language: string
          last_message_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          id?: string
          language?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          id?: string
          language?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          meta: Json | null
          sender_type: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          meta?: Json | null
          sender_type: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          meta?: Json | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          ai_analyzed_at: string | null
          ai_sentiment: string | null
          ai_suggested_response: string | null
          ai_topic: string | null
          ai_urgency_score: number | null
          assigned_to: string | null
          created_at: string
          description: string
          escalated: boolean | null
          escalated_at: string | null
          id: string
          order_id: string | null
          priority: Database["public"]["Enums"]["ticket_priority"]
          rated_at: string | null
          rating: number | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_analyzed_at?: string | null
          ai_sentiment?: string | null
          ai_suggested_response?: string | null
          ai_topic?: string | null
          ai_urgency_score?: number | null
          assigned_to?: string | null
          created_at?: string
          description: string
          escalated?: boolean | null
          escalated_at?: string | null
          id?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          rated_at?: string | null
          rating?: number | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_analyzed_at?: string | null
          ai_sentiment?: string | null
          ai_suggested_response?: string | null
          ai_topic?: string | null
          ai_urgency_score?: number | null
          assigned_to?: string | null
          created_at?: string
          description?: string
          escalated?: boolean | null
          escalated_at?: string | null
          id?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          rated_at?: string | null
          rating?: number | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      support_unanswered_questions: {
        Row: {
          added_to_faq: boolean | null
          conversation_id: string | null
          created_at: string | null
          id: string
          language: string | null
          question: string
          resolved: boolean | null
          user_id: string | null
        }
        Insert: {
          added_to_faq?: boolean | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          language?: string | null
          question: string
          resolved?: boolean | null
          user_id?: string | null
        }
        Update: {
          added_to_faq?: boolean | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          language?: string | null
          question?: string
          resolved?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_unanswered_questions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      supported_countries: {
        Row: {
          country_code: string
          country_name: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          updated_at: string
        }
        Insert: {
          country_code: string
          country_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          updated_at?: string
        }
        Update: {
          country_code?: string
          country_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          updated_at?: string
        }
        Relationships: []
      }
      system_audit_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          event_type: string
          id: string
          order_id: string | null
          payload: Json | null
          payment_attempt_id: string | null
          trace_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          payment_attempt_id?: string | null
          trace_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_type?: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          payment_attempt_id?: string | null
          trace_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      thread_messages: {
        Row: {
          created_at: string
          faq_id: string | null
          id: string
          message: string
          sender_id: string | null
          sender_type: string
          source: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          faq_id?: string | null
          id?: string
          message: string
          sender_id?: string | null
          sender_type: string
          source?: string
          thread_id: string
        }
        Update: {
          created_at?: string
          faq_id?: string | null
          id?: string
          message?: string
          sender_id?: string | null
          sender_type?: string
          source?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_messages_faq_id_fkey"
            columns: ["faq_id"]
            isOneToOne: false
            referencedRelation: "faq_kb"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          created_at: string
          id: string
          is_admin: boolean
          message: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_admin?: boolean
          message: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_admin?: boolean
          message?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          admin_role: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          admin_role?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          admin_role?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      catalog_providers_public: {
        Row: {
          adapter_name: string | null
          capabilities: Json | null
          color_hex: string | null
          display_name: string | null
          enabled: boolean | null
          environment: string | null
          id: string | null
          logo_url: string | null
          name: string | null
          priority: number | null
          updated_at: string | null
        }
        Insert: {
          adapter_name?: string | null
          capabilities?: Json | null
          color_hex?: string | null
          display_name?: string | null
          enabled?: boolean | null
          environment?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          priority?: number | null
          updated_at?: string | null
        }
        Update: {
          adapter_name?: string | null
          capabilities?: Json | null
          color_hex?: string | null
          display_name?: string | null
          enabled?: boolean | null
          environment?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_settings: {
        Row: {
          exchange_rate_usd_to_cdf: number | null
        }
        Relationships: []
      }
      safe_user_payments: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          id: string | null
          order_id: string | null
          paid_at: string | null
          provider_key: string | null
          reference: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          order_id?: string | null
          paid_at?: string | null
          provider_key?: string | null
          reference?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          order_id?: string | null
          paid_at?: string | null
          provider_key?: string | null
          reference?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _cron_call_refresh_worker: {
        Args: { p_body?: Json; p_mode: string }
        Returns: undefined
      }
      admin_catalog_category_counts: {
        Args: never
        Returns: {
          active_count: number
          category_key: string
          inactive_count: number
        }[]
      }
      admin_clear_search_cache: { Args: never; Returns: Json }
      admin_get_all_device_tokens: {
        Args: never
        Returns: {
          created_at: string
          id: string
          last_used_at: string
          platform: string
          user_id: string
        }[]
      }
      aggregate_popularity_scores: { Args: never; Returns: Json }
      autoprewarm_dump_now: { Args: never; Returns: number }
      autoprewarm_start_worker: { Args: never; Returns: undefined }
      bytea_to_text: { Args: { data: string }; Returns: string }
      can_access_ticket: {
        Args: { p_ticket_assigned_to: string; p_user_id: string }
        Returns: boolean
      }
      can_view_all_tickets: { Args: { p_user_id: string }; Returns: boolean }
      can_view_customer_profiles: {
        Args: { user_id: string }
        Returns: boolean
      }
      check_dual_rate_limit: {
        Args: {
          p_ip_key: string
          p_ip_limit: number
          p_user_key: string
          p_user_limit: number
          p_window_minutes: number
        }
        Returns: Json
      }
      check_provider_budget: {
        Args: { p_limit?: number; p_provider: string; p_window_type: string }
        Returns: Json
      }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_minutes: number }
        Returns: Json
      }
      claim_refresh_queue_jobs: {
        Args: { p_lock_id?: string; p_max_jobs?: number }
        Returns: {
          attempts: number | null
          category_key: string
          created_at: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          priority: number | null
          provider: string
          query: string
          scheduled_at: string | null
          status: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_refresh_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clean_expired_capture_cache: { Args: never; Returns: undefined }
      clean_expired_hot_cache: { Args: never; Returns: undefined }
      clean_expired_price_cache: { Args: never; Returns: undefined }
      clean_expired_product_cache: { Args: never; Returns: undefined }
      cleanup_all_expired_data: { Args: never; Returns: Json }
      cleanup_catalog_cache: { Args: never; Returns: Json }
      cleanup_catalog_provider_data: { Args: never; Returns: Json }
      cleanup_expired_facets_cache: { Args: never; Returns: Json }
      cleanup_expired_records: { Args: never; Returns: Json }
      cleanup_guest_cart_snapshots: { Args: never; Returns: Json }
      cleanup_home_seen_items: {
        Args: { p_days_to_keep?: number }
        Returns: Json
      }
      cleanup_invitation_attempts: { Args: never; Returns: Json }
      cleanup_search_query_log: { Args: { p_days?: number }; Returns: Json }
      clear_search_cache_by_pattern: {
        Args: { pattern: string }
        Returns: number
      }
      crosstab: { Args: { "": string }; Returns: Record<string, unknown>[] }
      crosstab2: {
        Args: { "": string }
        Returns: Database["public"]["CompositeTypes"]["tablefunc_crosstab_2"][]
        SetofOptions: {
          from: "*"
          to: "tablefunc_crosstab_2"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crosstab3: {
        Args: { "": string }
        Returns: Database["public"]["CompositeTypes"]["tablefunc_crosstab_3"][]
        SetofOptions: {
          from: "*"
          to: "tablefunc_crosstab_3"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crosstab4: {
        Args: { "": string }
        Returns: Database["public"]["CompositeTypes"]["tablefunc_crosstab_4"][]
        SetofOptions: {
          from: "*"
          to: "tablefunc_crosstab_4"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      each: { Args: { hs: unknown }; Returns: Record<string, unknown>[] }
      enqueue_all_seeds_ebay: { Args: { p_limit?: number }; Returns: Json }
      finalize_paid_order: {
        Args: {
          p_operator_ref?: string
          p_order_id: string
          p_payment_ref: string
          p_trace_id?: string
        }
        Returns: Json
      }
      generate_cart_hash_from_order: {
        Args: {
          p_currency: string
          p_order_id: string
          p_payment_method: string
        }
        Returns: string
      }
      generate_project_code: { Args: never; Returns: string }
      get_active_providers: {
        Args: never
        Returns: {
          item_count: number
          provider: string
        }[]
      }
      get_active_session: {
        Args: never
        Returns: {
          current_participant_count: number
          deadline_datetime: string
          desired_max_participants: number
          id: string
          is_active: boolean
          name: string
          review_progress: number
          start_date: string
          status: string
          target_applicants: number
        }[]
      }
      get_cached_price: {
        Args: { product_key_input: string; store_input: string }
        Returns: {
          canonical_url: string
          capture_count: number
          captured_at: string
          confidence: number
          currency: string
          expires_at: string
          id: string
          is_expired: boolean
          last_seen_at: string
          price_value: number
          product_key: string
          source: string
          store: string
          title: string
        }[]
      }
      get_catalog_breakdown_stats: {
        Args: never
        Returns: {
          category_count: number
          provider: string
          provider_count: number
          unified_category: string
        }[]
      }
      get_catalog_price_stats: {
        Args: never
        Returns: {
          avg_price: number
          total_value: number
        }[]
      }
      get_language_for_country: { Args: { p_country: string }; Returns: string }
      get_popular_queries: {
        Args: { p_limit?: number; p_window_hours?: number }
        Returns: {
          avg_db: number
          avg_live: number
          category_guess: string
          last_seen: string
          q_norm: string
          search_count: number
        }[]
      }
      get_price_instability: {
        Args: { product_key_input: string; store_input: string }
        Returns: Json
      }
      get_public_config: {
        Args: never
        Returns: {
          exchange_rate: number
          markup_percent: number
          shipping_base_fee: number
          shipping_percent: number
        }[]
      }
      get_public_exchange_rate: { Args: never; Returns: number }
      get_public_session_info: {
        Args: never
        Returns: {
          announcement_date: string
          application_fee: number
          currency: string
          current_participant_count: number
          deadline_datetime: string
          desired_max_participants: number
          enable_waitlist: boolean
          id: string
          name: string
          payment_instructions: string
          review_progress: number
          start_date: string
          status: string
          target_applicants: number
          waitlist_count: number
        }[]
      }
      get_recently_viewed: {
        Args: { p_device_id: string; p_limit?: number; p_user_id: string }
        Returns: {
          id: string
          image_url: string
          last_viewed_at: string
          product_url: string
          store_id: string
          title: string
          view_count: number
        }[]
      }
      get_session_progress: {
        Args: { session_uuid: string }
        Returns: {
          current_count: number
          deadline_datetime: string
          progress_percentage: number
          session_name: string
          status: string
          target_applicants: number
        }[]
      }
      get_store_cache_ttl: { Args: { store_input: string }; Returns: number }
      get_table_statistics: {
        Args: never
        Returns: {
          idx_scans: number
          index_usage_pct: number
          row_estimate: number
          seq_scans: number
          table_name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      increment_provider_budget: {
        Args: { p_limit?: number; p_provider: string; p_window_type: string }
        Returns: Json
      }
      is_admin:
        | { Args: never; Returns: boolean }
        | { Args: { check_user_id: string }; Returns: boolean }
      is_admin_cached: { Args: never; Returns: boolean }
      is_admin_role: { Args: never; Returns: boolean }
      is_email_verified: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_super_admin_role: { Args: never; Returns: boolean }
      match_faq: {
        Args: { lang?: string; user_text: string }
        Returns: {
          answer: string
          id: string
          priority: number
          question: string
          tags: string[]
          trigger_phrases: string[]
        }[]
      }
      merge_draft_orders: {
        Args: { p_primary_id: string; p_secondary_ids: string[] }
        Returns: Json
      }
      postgres_fdw_disconnect: { Args: { "": string }; Returns: boolean }
      postgres_fdw_disconnect_all: { Args: never; Returns: boolean }
      postgres_fdw_get_connections: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      postgres_fdw_handler: { Args: never; Returns: unknown }
      promote_popular_searches: {
        Args: {
          p_auto_enqueue?: boolean
          p_min_searches?: number
          p_window_hours?: number
        }
        Returns: Json
      }
      search_catalog_items_ranked: {
        Args: {
          p_limit?: number
          p_max_price?: number
          p_min_price?: number
          p_query: string
        }
        Returns: {
          brand: string
          id: string
          image_url: string
          price_usd: number
          product_url: string
          provider: string
          provider_product_id: string
          relevance: number
          title: string
        }[]
      }
      search_submission_by_code: {
        Args: { search_code: string }
        Returns: {
          created_at: string
          id: string
          project_code: string
          project_title: string
          submission_status: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soundex: { Args: { "": string }; Returns: string }
      sync_profile_emails: { Args: never; Returns: undefined }
      text_soundex: { Args: { "": string }; Returns: string }
      text_to_bytea: { Args: { data: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      upsert_cached_price: {
        Args: {
          canonical_url_input: string
          confidence_input: number
          currency_input: string
          price_value_input: number
          product_key_input: string
          source_input: string
          store_input: string
          title_input: string
          ttl_minutes: number
        }
        Returns: Json
      }
      upsert_recently_viewed: {
        Args: {
          p_device_id: string
          p_image_url?: string
          p_product_url: string
          p_store_id: string
          p_title?: string
          p_user_id: string
        }
        Returns: Json
      }
      upsert_store_visit: {
        Args: { p_device_id: string; p_store_id: string; p_user_id: string }
        Returns: Json
      }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
    }
    Enums: {
      app_role: "admin" | "user"
      order_status:
        | "DRAFT"
        | "PENDING_PAYMENT"
        | "PAID"
        | "PROCESSING"
        | "SHIPPED"
        | "READY_FOR_PICKUP"
        | "COMPLETED"
        | "CANCELLED"
      shipping_city: "KINSHASA" | "LUBUMBASHI" | "OTHER"
      store_type:
        | "AMAZON"
        | "EBAY"
        | "WALMART"
        | "CARVANA"
        | "CARGURUS"
        | "BESTBUY"
        | "OTHER"
        | "TESLA_USED"
        | "EDMUNDS"
        | "TEMU"
        | "WAYFAIR"
        | "MERCARI"
      ticket_priority: "low" | "medium" | "high" | "urgent"
      ticket_status:
        | "open"
        | "in_progress"
        | "waiting_customer"
        | "resolved"
        | "closed"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
      tablefunc_crosstab_2: {
        row_name: string | null
        category_1: string | null
        category_2: string | null
      }
      tablefunc_crosstab_3: {
        row_name: string | null
        category_1: string | null
        category_2: string | null
        category_3: string | null
      }
      tablefunc_crosstab_4: {
        row_name: string | null
        category_1: string | null
        category_2: string | null
        category_3: string | null
        category_4: string | null
      }
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
      app_role: ["admin", "user"],
      order_status: [
        "DRAFT",
        "PENDING_PAYMENT",
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "READY_FOR_PICKUP",
        "COMPLETED",
        "CANCELLED",
      ],
      shipping_city: ["KINSHASA", "LUBUMBASHI", "OTHER"],
      store_type: [
        "AMAZON",
        "EBAY",
        "WALMART",
        "CARVANA",
        "CARGURUS",
        "BESTBUY",
        "OTHER",
        "TESLA_USED",
        "EDMUNDS",
        "TEMU",
        "WAYFAIR",
        "MERCARI",
      ],
      ticket_priority: ["low", "medium", "high", "urgent"],
      ticket_status: [
        "open",
        "in_progress",
        "waiting_customer",
        "resolved",
        "closed",
      ],
    },
  },
} as const

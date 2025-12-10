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
          base_price_usd: number | null
          created_at: string
          est_weight_kg: number | null
          id: string
          is_saved_for_later: boolean
          is_vehicle: boolean | null
          last_reminder_at: string | null
          markup_fee_usd: number | null
          notes: string | null
          order_id: string
          product_image_url: string | null
          product_url: string
          quantity: number
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
        }
        Insert: {
          base_price_usd?: number | null
          created_at?: string
          est_weight_kg?: number | null
          id?: string
          is_saved_for_later?: boolean
          is_vehicle?: boolean | null
          last_reminder_at?: string | null
          markup_fee_usd?: number | null
          notes?: string | null
          order_id: string
          product_image_url?: string | null
          product_url: string
          quantity?: number
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
        }
        Update: {
          base_price_usd?: number | null
          created_at?: string
          est_weight_kg?: number | null
          id?: string
          is_saved_for_later?: boolean
          is_vehicle?: boolean | null
          last_reminder_at?: string | null
          markup_fee_usd?: number | null
          notes?: string | null
          order_id?: string
          product_image_url?: string | null
          product_url?: string
          quantity?: number
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
          carrier: string | null
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
          operator_ref_id: string | null
          payment_notes: string | null
          payment_verification_method: string | null
          payment_verified_at: string | null
          payment_verified_by: string | null
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
          carrier?: string | null
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
          operator_ref_id?: string | null
          payment_notes?: string | null
          payment_verification_method?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
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
          carrier?: string | null
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
          operator_ref_id?: string | null
          payment_notes?: string | null
          payment_verification_method?: string | null
          payment_verified_at?: string | null
          payment_verified_by?: string | null
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
      price_cache: {
        Row: {
          base_price: number
          currency: string | null
          display_price: string | null
          expires_at: string
          fetched_at: string
          id: string
          store: string
          url: string
        }
        Insert: {
          base_price: number
          currency?: string | null
          display_price?: string | null
          expires_at?: string
          fetched_at?: string
          id?: string
          store?: string
          url: string
        }
        Update: {
          base_price?: number
          currency?: string | null
          display_price?: string | null
          expires_at?: string
          fetched_at?: string
          id?: string
          store?: string
          url?: string
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
          price: number | null
          product_url: string
          source: string | null
          title: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          product_url: string
          source?: string | null
          title?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          product_url?: string
          source?: string | null
          title?: string | null
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
          name: string | null
          phone: string | null
          postal_code: string | null
          province: string | null
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
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
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
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          state_province?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quote_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          id: string
          order_item_id: string
          product_url: string | null
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
          id?: string
          order_item_id: string
          product_url?: string | null
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
          id?: string
          order_item_id?: string
          product_url?: string | null
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
      settings: {
        Row: {
          category_markups: Json | null
          created_at: string
          discount_codes: Json | null
          exchange_rate_usd_to_cdf: number
          extra_fees: Json | null
          global_markup_percent: number | null
          id: string
          markup_percent: number | null
          min_service_fee_usd: number | null
          service_fee_percent: number
          shipping_base_fee_usd: number
          shipping_percent: number
          updated_at: string
        }
        Insert: {
          category_markups?: Json | null
          created_at?: string
          discount_codes?: Json | null
          exchange_rate_usd_to_cdf?: number
          extra_fees?: Json | null
          global_markup_percent?: number | null
          id?: string
          markup_percent?: number | null
          min_service_fee_usd?: number | null
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
          updated_at?: string
        }
        Update: {
          category_markups?: Json | null
          created_at?: string
          discount_codes?: Json | null
          exchange_rate_usd_to_cdf?: number
          extra_fees?: Json | null
          global_markup_percent?: number | null
          id?: string
          markup_percent?: number | null
          min_service_fee_usd?: number | null
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
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
      support_tickets: {
        Row: {
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
      public_settings: {
        Row: {
          exchange_rate_usd_to_cdf: number | null
        }
        Relationships: []
      }
      safe_user_payments: {
        Row: {
          amount_cdf: number | null
          amount_usd: number | null
          created_at: string | null
          currency: string | null
          id: string | null
          maisha_reference: string | null
          order_id: string | null
          paid_at: string | null
          status: string | null
          updated_at: string | null
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
    }
    Functions: {
      clean_expired_price_cache: { Args: never; Returns: undefined }
      clean_expired_product_cache: { Args: never; Returns: undefined }
      generate_project_code: { Args: never; Returns: string }
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
      get_language_for_country: { Args: { p_country: string }; Returns: string }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
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
      sync_profile_emails: { Args: never; Returns: undefined }
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
      ticket_priority: "low" | "medium" | "high" | "urgent"
      ticket_status:
        | "open"
        | "in_progress"
        | "waiting_customer"
        | "resolved"
        | "closed"
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

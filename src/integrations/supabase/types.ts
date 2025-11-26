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
      order_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          order_id: string
          product_url: string
          quantity: number
          store: Database["public"]["Enums"]["store_type"]
          subtotal_usd: number | null
          title: string | null
          unit_price_usd: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          product_url: string
          quantity?: number
          store: Database["public"]["Enums"]["store_type"]
          subtotal_usd?: number | null
          title?: string | null
          unit_price_usd?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          product_url?: string
          quantity?: number
          store?: Database["public"]["Enums"]["store_type"]
          subtotal_usd?: number | null
          title?: string | null
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
        ]
      }
      orders: {
        Row: {
          created_at: string
          exchange_rate_used: number | null
          id: string
          item_total_usd: number | null
          maisha_payment_status: string | null
          maisha_transaction_id: string | null
          service_fee_usd: number | null
          shipping_city: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd: number | null
          status: Database["public"]["Enums"]["order_status"]
          total_cdf: number | null
          total_usd: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exchange_rate_used?: number | null
          id?: string
          item_total_usd?: number | null
          maisha_payment_status?: string | null
          maisha_transaction_id?: string | null
          service_fee_usd?: number | null
          shipping_city?: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          total_cdf?: number | null
          total_usd?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exchange_rate_used?: number | null
          id?: string
          item_total_usd?: number | null
          maisha_payment_status?: string | null
          maisha_transaction_id?: string | null
          service_fee_usd?: number | null
          shipping_city?: Database["public"]["Enums"]["shipping_city"] | null
          shipping_fee_usd?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          total_cdf?: number | null
          total_usd?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          name: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          exchange_rate_usd_to_cdf: number
          id: string
          service_fee_percent: number
          shipping_base_fee_usd: number
          shipping_percent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          exchange_rate_usd_to_cdf?: number
          id?: string
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          exchange_rate_usd_to_cdf?: number
          id?: string
          service_fee_percent?: number
          shipping_base_fee_usd?: number
          shipping_percent?: number
          updated_at?: string
        }
        Relationships: []
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
          role?: Database["public"]["Enums"]["app_role"]
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
    },
  },
} as const

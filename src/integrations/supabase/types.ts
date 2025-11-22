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
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          message: string
          subject: string
          whatsapp_number: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          message: string
          subject: string
          whatsapp_number?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string
          subject?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          error_message: string | null
          id: string
          sent_at: string
          status: string
          submission_id: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string
          status: string
          submission_id: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error_message?: string | null
          id?: string
          sent_at?: string
          status?: string
          submission_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "user_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          afrimoney_number: string | null
          airtel_money_number: string | null
          announcement_date: string | null
          application_fee: number | null
          created_at: string
          currency: string | null
          current_participant_count: number
          desired_max_participants: number
          enable_waitlist: boolean | null
          id: string
          m_pesa_number: string | null
          name: string
          orange_money_number: string | null
          payment_instructions: string | null
          review_progress: number
          start_date: string
          status: Database["public"]["Enums"]["session_status"]
          updated_at: string
          waitlist_count: number | null
        }
        Insert: {
          afrimoney_number?: string | null
          airtel_money_number?: string | null
          announcement_date?: string | null
          application_fee?: number | null
          created_at?: string
          currency?: string | null
          current_participant_count?: number
          desired_max_participants?: number
          enable_waitlist?: boolean | null
          id?: string
          m_pesa_number?: string | null
          name: string
          orange_money_number?: string | null
          payment_instructions?: string | null
          review_progress?: number
          start_date?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          waitlist_count?: number | null
        }
        Update: {
          afrimoney_number?: string | null
          airtel_money_number?: string | null
          announcement_date?: string | null
          application_fee?: number | null
          created_at?: string
          currency?: string | null
          current_participant_count?: number
          desired_max_participants?: number
          enable_waitlist?: boolean | null
          id?: string
          m_pesa_number?: string | null
          name?: string
          orange_money_number?: string | null
          payment_instructions?: string | null
          review_progress?: number
          start_date?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          waitlist_count?: number | null
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
      user_submissions: {
        Row: {
          agreements_confirmed: boolean
          city_province: string
          country: string | null
          created_at: string
          email: string
          estimated_monthly_revenue: number
          feasibility_explanation: string
          full_name: string
          funding_needed: number
          id: string
          number_of_hires: number | null
          payment_amount: number | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_phone_number: string | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          project_code: string | null
          project_description: string
          project_title: string
          project_type: string | null
          selection_timestamp: string | null
          session_id: string
          submission_status: Database["public"]["Enums"]["submission_status"]
          time_until_profit: string
          updated_at: string
          whatsapp_number: string
          will_hire: boolean
        }
        Insert: {
          agreements_confirmed?: boolean
          city_province: string
          country?: string | null
          created_at?: string
          email: string
          estimated_monthly_revenue: number
          feasibility_explanation: string
          full_name: string
          funding_needed: number
          id?: string
          number_of_hires?: number | null
          payment_amount?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_phone_number?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          project_code?: string | null
          project_description: string
          project_title: string
          project_type?: string | null
          selection_timestamp?: string | null
          session_id: string
          submission_status?: Database["public"]["Enums"]["submission_status"]
          time_until_profit: string
          updated_at?: string
          whatsapp_number: string
          will_hire?: boolean
        }
        Update: {
          agreements_confirmed?: boolean
          city_province?: string
          country?: string | null
          created_at?: string
          email?: string
          estimated_monthly_revenue?: number
          feasibility_explanation?: string
          full_name?: string
          funding_needed?: number
          id?: string
          number_of_hires?: number | null
          payment_amount?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_phone_number?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          project_code?: string | null
          project_description?: string
          project_title?: string
          project_type?: string | null
          selection_timestamp?: string | null
          session_id?: string
          submission_status?: Database["public"]["Enums"]["submission_status"]
          time_until_profit?: string
          updated_at?: string
          whatsapp_number?: string
          will_hire?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_project_code: { Args: never; Returns: string }
      get_public_session_info: {
        Args: never
        Returns: {
          announcement_date: string
          application_fee: number
          currency: string
          current_participant_count: number
          desired_max_participants: number
          enable_waitlist: boolean
          id: string
          name: string
          payment_instructions: string
          review_progress: number
          start_date: string
          status: string
          waitlist_count: number
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
      notification_channel: "email" | "whatsapp"
      notification_type: "winner" | "non_winner" | "info"
      payment_method: "airtel_money" | "orange_money" | "m_pesa" | "afrimoney"
      payment_status: "pending" | "paid" | "failed"
      session_status: "open" | "closed" | "results_published"
      submission_status:
        | "pending"
        | "under_review"
        | "selected"
        | "not_selected"
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
      notification_channel: ["email", "whatsapp"],
      notification_type: ["winner", "non_winner", "info"],
      payment_method: ["airtel_money", "orange_money", "m_pesa", "afrimoney"],
      payment_status: ["pending", "paid", "failed"],
      session_status: ["open", "closed", "results_published"],
      submission_status: [
        "pending",
        "under_review",
        "selected",
        "not_selected",
      ],
    },
  },
} as const

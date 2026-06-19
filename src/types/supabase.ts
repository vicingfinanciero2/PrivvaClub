// =====================================================================================
//  PrivvaClub — Tipos del esquema de base de datos (Supabase / PostgreSQL)
//
//  Refleja las migraciones 0001–0004. Mantener sincronizado con el backend.
//  En un proyecto enlazado se puede regenerar con:
//      supabase gen types typescript --local > src/types/supabase.ts
//  Este archivo es la versión escrita a mano equivalente, con las RPCs ya tipadas.
// =====================================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      cities: {
        Row: {
          id: number;
          name: string;
          slug: string;
          is_active: boolean;
          sort_order: number;
        };
        Insert: {
          id?: number;
          name: string;
          slug: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: {
          id?: number;
          name?: string;
          slug?: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };

      profiles: {
        Row: {
          id: string;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          credit_balance: number;
          account_status: Database["public"]["Enums"]["account_status_t"];
          billing_model: Database["public"]["Enums"]["billing_model_t"];
          subscription_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          credit_balance?: number;
          account_status?: Database["public"]["Enums"]["account_status_t"];
          billing_model?: Database["public"]["Enums"]["billing_model_t"];
          subscription_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          credit_balance?: number;
          account_status?: Database["public"]["Enums"]["account_status_t"];
          billing_model?: Database["public"]["Enums"]["billing_model_t"];
          subscription_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      creator_applications: {
        Row: {
          id: string;
          profile_id: string;
          status: Database["public"]["Enums"]["creator_app_status"];
          full_name: string | null;
          birth_date: string | null;
          doc_type: string | null;
          doc_number: string | null;
          doc_front_path: string | null;
          doc_back_path: string | null;
          selfie_path: string | null;
          selfie_with_doc_path: string | null;
          bank_name: string | null;
          bank_account_type: string | null;
          bank_account_number: string | null;
          social_instagram: string | null;
          social_tiktok: string | null;
          social_x: string | null;
          submitted_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          status?: Database["public"]["Enums"]["creator_app_status"];
          full_name?: string | null;
          birth_date?: string | null;
          doc_type?: string | null;
          doc_number?: string | null;
          doc_front_path?: string | null;
          doc_back_path?: string | null;
          selfie_path?: string | null;
          selfie_with_doc_path?: string | null;
          bank_name?: string | null;
          bank_account_type?: string | null;
          bank_account_number?: string | null;
          social_instagram?: string | null;
          social_tiktok?: string | null;
          social_x?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          status?: Database["public"]["Enums"]["creator_app_status"];
          full_name?: string | null;
          birth_date?: string | null;
          doc_type?: string | null;
          doc_number?: string | null;
          doc_front_path?: string | null;
          doc_back_path?: string | null;
          selfie_path?: string | null;
          selfie_with_doc_path?: string | null;
          bank_name?: string | null;
          bank_account_type?: string | null;
          bank_account_number?: string | null;
          social_instagram?: string | null;
          social_tiktok?: string | null;
          social_x?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "creator_applications_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      subscription_events: {
        Row: {
          id: string;
          profile_id: string;
          months: number;
          external_ref: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          months: number;
          external_ref: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          months?: number;
          external_ref?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscription_events_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      ads: {
        Row: {
          id: string;
          profile_id: string;
          title: string;
          description: string | null;
          price: number | null;
          city_id: number;
          zone_neighborhood: string | null;
          age: number | null;
          image_urls: string[];
          status: Database["public"]["Enums"]["ad_status_t"];
          bumped_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          title: string;
          description?: string | null;
          price?: number | null;
          city_id: number;
          zone_neighborhood?: string | null;
          age?: number | null;
          image_urls?: string[];
          status?: Database["public"]["Enums"]["ad_status_t"];
          bumped_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          title?: string;
          description?: string | null;
          price?: number | null;
          city_id?: number;
          zone_neighborhood?: string | null;
          age?: number | null;
          image_urls?: string[];
          status?: Database["public"]["Enums"]["ad_status_t"];
          bumped_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ads_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ads_city_id_fkey";
            columns: ["city_id"];
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };

      ads_verification: {
        Row: {
          ad_id: string;
          is_verified_by_studio: boolean;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          ad_id: string;
          is_verified_by_studio?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          ad_id?: string;
          is_verified_by_studio?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ads_verification_ad_id_fkey";
            columns: ["ad_id"];
            referencedRelation: "ads";
            referencedColumns: ["id"];
          },
        ];
      };

      credit_transactions: {
        Row: {
          id: string;
          profile_id: string;
          amount: number;
          transaction_type: Database["public"]["Enums"]["transaction_type_t"];
          ad_id: string | null;
          external_ref: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          amount: number;
          transaction_type: Database["public"]["Enums"]["transaction_type_t"];
          ad_id?: string | null;
          external_ref?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          amount?: number;
          transaction_type?: Database["public"]["Enums"]["transaction_type_t"];
          ad_id?: string | null;
          external_ref?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_transactions_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      chat_rooms: {
        Row: {
          id: string;
          ad_id: string;
          advertiser_id: string;
          client_session_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ad_id: string;
          advertiser_id: string;
          client_session_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ad_id?: string;
          advertiser_id?: string;
          client_session_id?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_rooms_ad_id_fkey";
            columns: ["ad_id"];
            referencedRelation: "ads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_rooms_advertiser_id_fkey";
            columns: ["advertiser_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      chat_messages: {
        Row: {
          id: number;
          room_id: string;
          sender_type: Database["public"]["Enums"]["sender_type_t"];
          message_text: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          room_id: string;
          sender_type: Database["public"]["Enums"]["sender_type_t"];
          message_text: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          room_id?: string;
          sender_type?: Database["public"]["Enums"]["sender_type_t"];
          message_text?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_id_fkey";
            columns: ["room_id"];
            referencedRelation: "chat_rooms";
            referencedColumns: ["id"];
          },
        ];
      };
    };

    Views: Record<never, never>;

    Functions: {
      // ---- Chat anónimo (rol anon) -----------------------------------------------
      fn_get_or_create_chat_room: {
        Args: { p_ad_id: string; p_session_id: string };
        Returns: string;
      };
      fn_send_client_message: {
        Args: { p_room_id: string; p_session_id: string; p_text: string };
        Returns: number;
      };
      fn_get_messages: {
        Args: { p_room_id: string; p_session_id: string };
        Returns: Database["public"]["Tables"]["chat_messages"]["Row"][];
      };
      fn_mark_read_by_client: {
        Args: { p_room_id: string; p_session_id: string };
        Returns: undefined;
      };

      // ---- Monetización (rol authenticated) --------------------------------------
      fn_bump_ad: {
        Args: { target_ad_id: string };
        Returns: string; // bumped_at (timestamptz)
      };
      fn_publish_ad: {
        Args: { target_ad_id: string };
        Returns: Database["public"]["Enums"]["ad_status_t"];
      };

      // ---- Administración (rol admin) --------------------------------------------
      fn_verify_ad_by_admin: {
        Args: { p_ad_id: string; p_is_verified: boolean };
        Returns: boolean;
      };

      has_active_subscription: {
        Args: { p_profile_id: string };
        Returns: boolean;
      };
      fn_submit_creator_application: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["creator_app_status"];
      };

      // ---- Solo servidor (service_role) — NO invocar desde el cliente ------------
      fn_deposit_credits_by_admin: {
        Args: { p_profile_id: string; p_amount: number; p_transaction_id: string };
        Returns: number;
      };
      fn_activate_subscription_by_admin: {
        Args: { p_profile_id: string; p_months: number; p_transaction_id: string };
        Returns: string;
      };
      fn_purge_old_anonymous_chats: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };

    Enums: {
      account_status_t: "pending_review" | "active" | "suspended";
      ad_status_t: "draft" | "active" | "archived";
      transaction_type_t: "deposit" | "ad_publish" | "ad_bump";
      sender_type_t: "advertiser" | "client";
      billing_model_t: "credits" | "subscription";
      creator_app_status: "draft" | "submitted" | "in_review" | "approved" | "rejected";
    };

    CompositeTypes: Record<never, never>;
  };
};

// -------------------------------------------------------------------------------------
// Helpers de conveniencia (al estilo de los tipos generados por Supabase).
// -------------------------------------------------------------------------------------
type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];

// Alias semánticos de uso frecuente en la app.
export type Profile = Tables<"profiles">;
export type Ad = Tables<"ads">;
export type AdVerification = Tables<"ads_verification">;
export type City = Tables<"cities">;
export type ChatRoom = Tables<"chat_rooms">;
export type ChatMessage = Tables<"chat_messages">;
export type CreditTransaction = Tables<"credit_transactions">;

export type AccountStatus = Enums<"account_status_t">;
export type AdStatus = Enums<"ad_status_t">;
export type TransactionType = Enums<"transaction_type_t">;
export type SenderType = Enums<"sender_type_t">;
export type BillingModel = Enums<"billing_model_t">;
export type SubscriptionEvent = Tables<"subscription_events">;
export type CreatorApplication = Tables<"creator_applications">;
export type CreatorAppStatus = Enums<"creator_app_status">;

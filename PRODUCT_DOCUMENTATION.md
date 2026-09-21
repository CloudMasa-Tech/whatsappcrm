# CloudMaSa CRM (MaSa CRM) & Omnichannel Gateway
## Comprehensive Enterprise Architecture, Technical Flow & Operations Manual

---

## 📑 Table of Contents

1. [Executive Summary & Product Vision](#1-executive-summary--product-vision)
2. [System Architecture & Topology](#2-system-architecture--topology)
3. [Multi-Tenancy, Hierarchy & Role-Based Access Control (RBAC)](#3-multi-tenancy-hierarchy--role-based-access-control-rbac)
   - [3.1 Two-Tier Tenancy Hierarchy](#31-two-tier-tenancy-hierarchy)
   - [3.2 Role Permissions Matrix & Designated Default Admin Safeguard](#32-role-permissions-matrix--designated-default-admin-safeguard)
   - [3.3 Session Scoping & Project Context Guard](#33-session-scoping--project-context-guard)
   - [3.4 Tenant & User Provisioning Lifecycle Flow](#34-tenant--user-provisioning-lifecycle-flow)
4. [Channel Gateways & Ingestion Architecture (Detailed Technical Flows)](#4-channel-gateways--ingestion-architecture-detailed-technical-flows)
   - [4.1 WhatsApp Web QR Gateway (Baileys Multi-Device)](#41-whatsapp-web-qr-gateway-baileys-multi-device)
   - [4.2 WhatsApp Address Book Sync & Smart Contact Cleanup Engine](#42-whatsapp-address-book-sync--smart-contact-cleanup-engine)
   - [4.3 Dedicated Project SMTP Email Engine (Tracking & Merge Tags)](#43-dedicated-project-smtp-email-engine-tracking--merge-tags)
   - [4.4 Meta WhatsApp Cloud API & Social Inboxes (Instagram / Facebook)](#44-meta-whatsapp-cloud-api--social-inboxes-instagram--facebook)
   - [4.5 Channel Readiness Health Monitor](#45-channel-readiness-health-monitor)
5. [Core Platform Modules & End-to-End Technical Flows](#5-core-platform-modules--end-to-end-technical-flows)
   - [5.1 Unified Omnichannel Inbox & Real-Time Collaborative Streaming](#51-unified-omnichannel-inbox--real-time-collaborative-streaming)
   - [5.2 SLA Snooze Follow-Ups & Automated Unsnooze Countdown](#52-sla-snooze-follow-ups--automated-unsnooze-countdown)
   - [5.3 Message Templates & Multi-Format Direct Media Uploads](#53-message-templates--multi-format-direct-media-uploads)
   - [5.4 Central Template Moderation & Multi-Tier Approval (`/admin/templates`)](#54-central-template-moderation--multi-tier-approval-admintemplates)
   - [5.5 Contacts & Lead Lifecycle Management](#55-contacts--lead-lifecycle-management)
   - [5.6 Deals Kanban Sales Pipeline & 1-Click WhatsApp Outreach](#56-deals-kanban-sales-pipeline--1-click-whatsapp-outreach)
   - [5.7 Visual Automation Flow Builder & Human Handoff Engine](#57-visual-automation-flow-builder--human-handoff-engine)
   - [5.8 AI Knowledge Base & RAG Engine (`pgvector`)](#58-ai-knowledge-base--rag-engine-pgvector)
   - [5.9 Multi-Channel Broadcast Campaigns & Jitter Rate Limiting](#59-multi-channel-broadcast-campaigns--jitter-rate-limiting)
   - [5.10 Mobile Compatibility Suite & Responsive Architecture](#510-mobile-compatibility-suite--responsive-architecture)
6. [Super Admin Platform Governance & Telemetry](#6-super-admin-platform-governance--telemetry)
7. [Security, Cryptography & Compliance](#7-security-cryptography--compliance)
8. [Database Schema Dictionary](#8-database-schema-dictionary)
9. [REST API & Webhook Specifications](#9-rest-api--webhook-specifications)
10. [End-to-End Operational Walkthrough (The 5-Step Revenue Lifecycle)](#10-end-to-end-operational-walkthrough-the-5-step-revenue-lifecycle)
11. [Developer Quick Start & Operations Guide](#11-developer-quick-start--operations-guide)
12. [Verification, Quality Assurance & Test Matrix](#12-verification-quality-assurance--test-matrix)

---

## 1. Executive Summary & Product Vision

**CloudMaSa CRM (MaSa CRM)** is an enterprise-grade, multi-tenant Omnichannel Customer Relationship Management (CRM) and Marketing Automation platform. Engineered specifically for high-velocity sales, customer support, and automated conversational commerce, it connects traditional customer relationship databases directly to modern messaging channels:

- **WhatsApp Web QR Code Connection**: Independent, lightweight Baileys-powered multi-device gateway requiring zero Meta Business verification.
- **Meta WhatsApp Cloud API**: Official WhatsApp Business Platform with template synchronization, interactive messages, and webhook verification.
- **Social Inboxes**: Instagram Direct & Facebook Messenger synchronized into a single unified conversation stream.
- **Project-Specific Email Campaign Gateway**: Dedicated SMTP engine per project (Gmail, Outlook/Office 365, Zoho, Custom SMTP) with open/click tracking and dynamic merge tags.
- **Visual Automation Flow Builder**: Interactive drag-and-drop node canvas for triggers, conditions, branching, human handoff, and LLM-driven AI agents.
- **AI Knowledge Base (RAG Engine)**: Context-aware conversational AI grounded on company documents, PDFs, and FAQs with semantic search using `pgvector`.
- **Smart Contact Lifecycle & Cleanup**: Automatic cleanup of passive WhatsApp address book syncs while guaranteeing preservation of CRM-engaged contacts.
- **Enterprise Multi-Tenancy & RBAC**: Hierarchical account/project isolation with Super Admin provisioning, Designated Default Admin safeguards, and dynamic Agent role management.
- **Mobile Responsive Design**: Notch safe-area adaptation, sliding drawer navigation with project switcher, mobile contact details sheet, and touch hitboxes.

---

## 2. System Architecture & Topology

The platform architecture decouples real-time gateway socket microservices from Next.js server-rendered application logic and Supabase managed PostgreSQL infrastructure:

```mermaid
graph TD
    subgraph ClientTier ["Client Presentation Layer"]
        DesktopWeb["Desktop Browser (Chrome / Edge / Safari)"]
        MobileWeb["Mobile Web App / PWA (iOS Safari / Android)"]
        SuperAdminDesk["Super Admin Platform Console"]
    end

    subgraph AppTier ["Application Tier (Next.js 16 - Port 3000)"]
        NextServer["Next.js Server (App Router & SSR)"]
        AuthGuards["SSR Auth & Project Cookie Guard"]
        APIRoutes["REST Endpoints & Webhook Handlers"]
        FlowEngine["Visual Flow Execution Runtime"]
        EmailService["Nodemailer Project SMTP Gateway"]
    end

    subgraph GatewayTier ["Microservice Gateway (Baileys - Port 8088)"]
        BaileysSocket["Baileys Multi-Device Socket Manager"]
        SSEStreamer["SSE Realtime QR Streamer"]
        GatewayCrypto["AES-256-GCM Session Manager"]
    end

    subgraph DataTier ["Persistence & Cloud Infrastructure (Supabase)"]
        Postgres["PostgreSQL 15+ Engine (RLS Enforced)"]
        RealtimeCDC["Supabase Realtime (CDC / WebSockets)"]
        PgVectorExt["pgvector Embedding Storage"]
        MediaBuckets["Encrypted Storage Buckets ('chat-media')"]
    end

    subgraph ExternalEcosystem ["External Cloud Ecosystem"]
        MetaGraphAPI["Meta Graph API v21.0 (Cloud API, IG, FB)"]
        SMTPProviders["Project SMTP (Gmail, O365, Zoho, Custom)"]
        LLMInference["AI Inference (OpenAI / Gemini / Ollama)"]
    end

    DesktopWeb --> NextServer
    MobileWeb --> NextServer
    SuperAdminDesk --> NextServer

    NextServer --> AuthGuards
    AuthGuards --> Postgres
    NextServer --> APIRoutes

    APIRoutes --> Postgres
    APIRoutes --> RealtimeCDC
    APIRoutes --> PgVectorExt
    APIRoutes --> MediaBuckets
    APIRoutes --> BaileysSocket
    APIRoutes --> MetaGraphAPI
    APIRoutes --> EmailService

    EmailService --> SMTPProviders
    FlowEngine --> LLMInference

    BaileysSocket --> GatewayCrypto
    BaileysSocket --> Postgres
    BaileysSocket --> SSEStreamer
```

### Component Port & Service Allocations

| Service / Component | Default Port | Protocol | Primary Responsibilities |
| :--- | :---: | :---: | :--- |
| **Next.js Core Application** | `3000` | HTTP / HTTPS | SSR page rendering, API routes, RBAC guards, Supabase client |
| **WhatsApp QR Gateway** | `8088` | HTTP / SSE / WSS | Baileys multi-device WebSockets, QR generation, auth keys |
| **Supabase PostgreSQL** | `5432` / `6543` | PostgreSQL | Relational storage, RLS enforcement, pgvector similarity |
| **Supabase Realtime** | `443` | WSS | Change Data Capture (CDC) streaming to inbox clients |
| **Project SMTP Gateways** | `587` / `465` | SMTP / TLS | Dedicated outbound email dispatches per project |

---

## 3. Multi-Tenancy, Hierarchy & Role-Based Access Control (RBAC)

### 3.1 Two-Tier Tenancy Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                      Super Admin Account                    │
│   (Global Tenant Provisioning, Telemetry, Cross-Project)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
    ┌──────────────────────────┐  ┌──────────────────────────┐
    │    Account / Client A    │  │    Account / Client B    │
    │    (Billing Boundary)    │  │    (Billing Boundary)    │
    └────────────┬─────────────┘  └────────────┬─────────────┘
                 │                             │
         ┌───────┴───────┐             ┌───────┴───────┐
         ▼               ▼             ▼               ▼
   ┌───────────┐   ┌───────────┐ ┌───────────┐   ┌───────────┐
   │ Project 1 │   │ Project 2 │ │ Project 3 │   │ Project 4 │
   │  (Sales)  │   │ (Support) │ │(Marketing)│   │   (VIP)   │
   └───────────┘   └───────────┘ └───────────┘   └───────────┘
```

1. **Account (`accounts`)**: Highest-level organization unit managing billing, global features, and platform identity.
2. **Project (`projects`)**: Complete data-isolation boundary. Every contact, conversation, WhatsApp session, email config, pipeline deal, automation flow, and API key is strictly scoped to a single `project_id`.
3. **Project Scoping**: Users switch projects effortlessly via the top navigation bar. When active, all data fetching (`masacrm_project` cookie) automatically bounds queries to that project's boundary.

---

### 3.2 Role Permissions Matrix & Designated Default Admin Safeguard

| Capability / Action | Super Admin | Default Admin (`default_admin`) | Project Admin | Agent |
| :--- | :---: | :---: | :---: | :---: |
| Access Global Platform `/admin` | ✅ | ❌ | ❌ | ❌ |
| Create / Delete Client Accounts & Projects | ✅ | ❌ | ❌ | ❌ |
| Demote / Delete Default Primary Admin | ✅ | ❌ | ❌ | ❌ |
| Switch Other Members (Agent $\leftrightarrow$ Admin) | ✅ | ✅ | ✅ | ❌ |
| Connect / Disconnect Project WhatsApp & Email | ✅ | ✅ | ✅ | ❌ |
| Configure Visual Automation Flows & Triggers | ✅ | ✅ | ✅ | ❌ |
| Access Unified Inbox & Reply to Customers | ✅ | ✅ | ✅ | ✅ |
| Update Deal Stages, Tags, and Custom Fields | ✅ | ✅ | ✅ | ✅ |
| View Assigned Conversations & Claim Chats | ✅ | ✅ | ✅ | ✅ |
| Create & Dispatch WhatsApp / Email Broadcasts | ✅ | ✅ | ✅ | ❌ |

#### The Designated Default Admin Safeguard
- When the Super Admin provisions a customer account, the primary contact is marked with the `default_admin` tag (`is_default_admin = true`) in the database.
- **Protection**: Other project administrators cannot accidentally demote, lock out, or delete the primary default admin. A distinctive purple badge appears in the **Settings $\to$ Team Members** UI.
- Other team members can freely be elevated to Admin or transitioned back to Agent by the Default Admin or Super Admin.

---

### 3.3 Session Scoping & Project Context Guard

When a user interacts with the application:
1. The client browser sets the `masacrm_project` cookie containing the active `project_id`.
2. Server Components and API routes read this cookie through `getActiveProjectId()`.
3. Every database query appends `.eq('project_id', activeProjectId)` and passes through PostgreSQL Row-Level Security (RLS) policies checking `is_project_member(project_id, auth.uid())`.
4. If a user attempts to access resources from a project they do not belong to, RLS immediately returns empty sets or throws permission denied errors.

---

### 3.4 Tenant & User Provisioning Lifecycle Flow

```mermaid
sequenceDiagram
    autonumber
    actor SA as Super Admin
    participant Web as Platform Console (/admin)
    participant Auth as Supabase Auth
    participant DB as PostgreSQL DB
    participant Mail as System SMTP (Nodemailer)
    actor DA as Designated Default Admin

    SA->>Web: Input Account Name, Project Name, Admin Email
    Web->>Auth: Admin User Creation (auth.admin.createUser)
    Auth-->>Web: User ID & Temporary Credentials
    Web->>DB: INSERT into accounts (name, status)
    Web->>DB: INSERT into projects (account_id, name)
    Web->>DB: INSERT into project_members (project_id, user_id, role='admin', is_default_admin=true)
    Web->>Mail: Dispatch Onboarding Email with Magic Link
    Mail-->>DA: Deliver Invitation Email
    DA->>Web: Click Magic Link & Set Password
    Web->>Auth: Establish Session & Cookie (masacrm_project)
    Web-->>DA: Redirect to Project Dashboard
```

---

## 4. Channel Gateways & Ingestion Architecture (Detailed Technical Flows)

### 4.1 WhatsApp Web QR Gateway (Baileys Multi-Device)

The WhatsApp QR Gateway operates as an autonomous Node.js service utilizing `@whiskeysockets/baileys` to establish native WebSocket connections to WhatsApp Web infrastructure.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Project Admin
    participant UI as CRM Settings (qr-pairing.tsx)
    participant NextAPI as Next.js API (/api/whatsapp/qr)
    participant Gateway as Gateway Service (Port 8088)
    participant Baileys as Baileys Socket Engine
    participant DB as PostgreSQL (qr_sessions)
    actor Phone as WhatsApp Mobile Device

    Admin->>UI: Click "Generate QR Code"
    UI->>NextAPI: POST /api/whatsapp/qr (projectId)
    NextAPI->>Gateway: POST /sessions/init (projectId, webhookUrl)
    Gateway->>Baileys: makeWASocket(authCreds, fetchKeys)
    Baileys-->>Gateway: Connection Update (QR Raw String)
    Gateway-->>UI: Stream QR String via Server-Sent Events (SSE)
    UI-->>Admin: Render Live QR Code Canvas
    Admin->>Phone: Open WhatsApp -> Linked Devices -> Link a Device
    Phone->>UI: Scan QR Code
    Baileys->>Gateway: Event 'connection.update' (status: 'open')
    Gateway->>DB: Encrypt Session Keys (AES-256-GCM) & Save
    Gateway->>NextAPI: Signed Webhook (status: 'CONNECTED', phone: '1555...')
    NextAPI->>DB: UPDATE project_channels (status: 'connected')
    UI-->>Admin: Status turns Green: "Connected (Live)"
```

#### Socket Lifecycle & Reconnection State Machine

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Initializing: User triggers Connect
    Initializing --> AwaitingScan: QR Code Generated
    AwaitingScan --> Authenticated: Phone Scans QR
    AwaitingScan --> Disconnected: QR Expires (60s timeout)
    Authenticated --> Connected: Socket 'open'
    Connected --> Reconnecting: Network Drop / Ping Timeout
    Reconnecting --> Connected: Auto-Reconnect Successful
    Reconnecting --> Disconnected: Disconnect Code 401 (Logged Out)
    Connected --> Disconnected: User Clicks Disconnect
    Disconnected --> [*]
```

#### WhatsApp Gateway Disconnect Codes Handled:
- **Code 401 (Logged Out)**: Session invalidated on mobile device. Gateway clears `qr_sessions` and triggers contact cleanup.
- **Code 428 (Precondition Required)**: Connection dropped by peer; automatic immediate socket restart.
- **Code 515 (Restart Required)**: Internal Baileys handshake requirement; gateway immediately re-establishes socket with existing credentials.

---

### 4.2 WhatsApp Address Book Sync & Smart Contact Cleanup Engine

When a mobile phone connects via QR code, WhatsApp automatically syncs the device's personal address book. In high-volume setups, this can inject thousands of non-customer contacts into the database.

CloudMaSa CRM implements a built-in **Smart Cleanup Engine** (`src/lib/contacts/cleanup-synced.ts`):

```mermaid
flowchart TD
    Trigger["WhatsApp Disconnected OR Manual Click 'Clean Synced Contacts'"] --> Scan["Fetch All Contacts in Project"]
    Scan --> Analyze{"Evaluate Contact Activity"}

    Analyze -- "CRITERIA MET (PRESERVE)" --> Keep["PRESERVE CONTACT<br/>• Messages sent by team (sender_type='agent')<br/>• Assigned to an agent (assigned_agent_id IS NOT NULL)<br/>• Active reminders in conversation_reminders<br/>• Has tags in contact_tags<br/>• Has deals (value > 0 OR status in 'won'/'lost' OR notes)<br/>• Targeted in broadcast_recipients<br/>• Has email, company, or social channel (IG/FB)"]

    Analyze -- "NO CRITERIA MET (PURGE)" --> Delete["PURGE CONTACT<br/>• Passive address book entry<br/>• Zero messages sent by team<br/>• Unassigned, no deals, no tags"]

    Delete --> Exec["DELETE FROM contacts WHERE id IN (toDeleteIds)"]
    Keep --> Retain["Retain with 100% Data Integrity"]
```

#### Execution Triggers:
1. **Automatic Trigger**: Executes automatically whenever a WhatsApp session is disconnected (`DELETE /api/whatsapp/qr`, gateway event `session.disconnected`, or mobile logout).
2. **On-Demand Trigger**: Accessible at any time in **Settings $\to$ WhatsApp $\to$ Clean Synced Contacts** or via `POST /api/contacts/cleanup-synced`.
3. **Safety Guarantee**: Only completely un-interacted address book entries are purged; all customer conversations, notes, and pipeline leads are 100% retained.

---

### 4.3 Dedicated Project SMTP Email Engine (Tracking & Merge Tags)

Email configurations are strictly isolated per project in `public.email_configs` with `UNIQUE (project_id)`.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Project Admin
    participant UI as Email Settings
    participant API as Next.js Email API (/api/email/campaigns)
    participant Transport as Nodemailer Transport Factory
    participant SMTP as Project SMTP Server
    actor Lead as Recipient Customer

    Admin->>UI: Configure SMTP (Host, Port, User, Pass)
    Admin->>UI: Click "Test Connection"
    UI->>API: POST /api/email/config/test
    API->>Transport: verifyTransporter(projectConfig)
    Transport->>SMTP: SMTP Handshake & Auth
    SMTP-->>Transport: 250 OK
    Transport-->>UI: "Connection Verified"

    Admin->>UI: Create & Dispatch Email Campaign
    UI->>API: POST /api/email/campaigns/send
    API->>API: Replace Merge Tags ({{name}}, {{company}})
    API->>API: Inject 1x1 Transparent Pixel (<img src="/api/email/track/open/[token]"/>)
    API->>API: Rewrite Links (<a href="/api/email/track/click/[token]?url=...">)
    API->>Transport: sendMail(compiledHTML)
    Transport->>SMTP: Outbound Mail Dispatch
    SMTP-->>Lead: Deliver Message

    Lead->>Lead: Opens Email (Pixel Triggers GET /api/email/track/open)
    API->>API: Record Open Timestamp in email_campaign_recipients
    Lead->>Lead: Clicks Link (Triggers GET /api/email/track/click)
    API->>API: Record Click Timestamp & Redirect to Destination URL
```

#### Provider Presets & Parameters:
- **Gmail / Google Workspace**: `smtp.gmail.com:587` (App Passwords required).
- **Microsoft Outlook / Office 365**: `smtp.office365.com:587`.
- **Zoho Mail**: `smtp.zoho.com:465` (SSL).
- **Custom Corporate SMTP**: Configurable Host, Port, Secure (TLS/SSL), Username, and Password.

---

### 4.4 Meta WhatsApp Cloud API & Social Inboxes (Instagram / Facebook)

```mermaid
sequenceDiagram
    autonumber
    actor User as WhatsApp / Instagram User
    participant Meta as Meta Graph API (v21.0)
    participant Webhook as Next.js Inbound Webhook (/api/webhook/whatsapp)
    participant Crypto as HMAC-SHA256 Validator
    participant DB as PostgreSQL DB
    participant CDC as Supabase Realtime
    actor Agent as Sales / Support Agent

    User->>Meta: Send WhatsApp Text or Instagram DM
    Meta->>Webhook: POST Webhook Payload (with X-Hub-Signature-256)
    Webhook->>Crypto: Verify HMAC against META_APP_SECRET
    Crypto-->>Webhook: Signature Validated
    Webhook->>DB: Upsert Contact & Conversation
    Webhook->>DB: INSERT into messages (sender_type='contact', content)
    DB->>CDC: Change Data Capture Notification
    CDC-->>Agent: Live Audio Chime & Instant Message Render in Inbox
```

---

### 4.5 Channel Readiness Health Monitor

The platform provides a consolidated readiness endpoint (`GET /api/channels/readiness?projectId=...`) that verifies:
- WhatsApp Web QR gateway socket health and phone battery status.
- Meta Cloud API access token validity.
- Project SMTP connection availability.
- Webhook registration statuses.

---

## 5. Core Platform Modules & End-to-End Technical Flows

### 5.1 Unified Omnichannel Inbox & Real-Time Collaborative Streaming

```
┌─────────────────────────┬───────────────────────────────┬───────────────────────────┐
│       Chat Queue        │       Live Conversation       │   Contact Details Sheet   │
│  [All] [Mine] [Pending] │  [10:00] Lead: Need brochure  │ Name: Alex Rivera         │
│  ● Alex Rivera (Unread) │  [10:01] Claimed by Sarah     │ Phone: +1 555-0199        │
│  ○ Priya Sharma (1h)    │  [10:02] [Note] VIP client    │ Deal: $12,500 (Proposal)  │
│  ○ Acme Corp (Closed)   │  [10:03] Agent: Sent catalog! │ Tags: [Enterprise] [Q3]   │
│                         │  [Type message / Slash '/']   │ Custom: Renewal=Nov 2026  │
└─────────────────────────┴───────────────────────────────┴───────────────────────────┘
```

#### Core Inbox Capabilities:
1. **Real-Time CDC Ingestion**: Messages stream directly into the UI via Supabase Realtime WebSocket subscriptions without polling.
2. **Agent Tabs**:
   - **All Chats**: Organization-wide chronological stream.
   - **My Assigned**: Conversations explicitly owned by the logged-in agent.
   - **Unassigned**: New incoming leads awaiting triage. Agents click **"Claim"** with 1-click.
   - **Pending / Snoozed**: Conversations placed on follow-up hold.
3. **Collision Detection & Heartbeat Presence**: Typing indicators and active viewer avatars alert agents if a colleague is already viewing or responding to a chat.
4. **Internal Private Notes**: Yellow cards stored in `contact_notes` visible only to internal team members.
5. **Slash Commands (`/`)**: Instant canned response drawer with keyboard navigation.
6. **AI Smart Drafts**: One-click contextual draft generation based on past conversation history.
7. **Audio Voice Notes**: Built-in voice recorder using Web Audio API / MediaRecorder with in-browser waveform playback.

---

### 5.2 SLA Snooze Follow-Ups & Automated Unsnooze Countdown

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Support Agent
    participant Inbox as Inbox UI (message-thread.tsx)
    participant API as Next.js API (/api/conversations/[id]/snooze)
    participant DB as PostgreSQL DB
    participant Timer as Live Countdown Hook
    actor Customer as Customer

    Agent->>Inbox: Click Snooze (1h, 3h, 24h, Custom)
    Inbox->>API: POST /snooze (snoozeUntil: '2026-09-21T16:00:00Z')
    API->>DB: UPDATE conversations SET status='pending', snoozed_until=timestamp
    DB-->>Inbox: Conversation moves to "Pending" Tab
    Inbox->>Timer: Mount Live Countdown Badge (e.g. "Snoozed: 58m remaining")
    
    alt Snooze Duration Expires
        Timer->>Timer: Countdown reaches 00:00:00
        Timer->>API: POST /api/conversations/[id]/unsnooze
        API->>DB: UPDATE conversations SET status='open', snoozed_until=NULL
        DB-->>Inbox: Conversation pops back into "Open" / "Mine" queue with Alert Chime
    else Customer Inbound Reply Before Expiry
        Customer->>DB: Sends New Inbound WhatsApp Message
        DB->>DB: Trigger automatically sets status='open', snoozed_until=NULL
        DB-->>Inbox: Instant Un-snooze and Pop to Top of Active Queue
    end
```

---

### 5.3 Message Templates & Multi-Format Direct Media Uploads

CloudMaSa CRM supports rich multimedia templates with direct in-modal uploads for images, videos, and documents:

```
┌─────────────────────────────────────────────────────────────┐
│                     New Message Template                    │
│  Name: product_launch_2026       Category: Marketing        │
│  Language: en_US                 Header: Document           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ [Upload Document] (PDF, Word, Excel up to 16 MB)      │  │
│  │ Attached: Q3_Catalog_Final.pdf  [View Link]  [✕]      │  │
│  └───────────────────────────────────────────────────────┘  │
│  Body Text:                                                 │
│  Hello {{1}}, here is your requested catalog for {{2}}!     │
│  Buttons: [URL: View Catalog]  [Quick Reply: Talk to Sales] │
│  [Cancel]                               [Submit for Review] │
└─────────────────────────────────────────────────────────────┘
```

#### Media Header Specifications:

| Header Format | Supported Extensions | File Size Limit | Upload Button | In-Modal Preview Experience |
| :--- | :--- | :---: | :--- | :--- |
| **None** | — | — | — | Pure text body and optional buttons |
| **Text** | — | — | — | Header text string with optional `{{1}}` |
| **Image** | `.jpg`, `.jpeg`, `.png` | $\le$ 5 MB | **"Upload Image"** | High-resolution thumbnail preview with clear (`✕`) button |
| **Video** | `.mp4`, `.3gp` | $\le$ 16 MB | **"Upload Video"** | Embedded playable HTML5 `<video>` controls with clear (`✕`) |
| **Document** | `.pdf`, `.docx`, `.xlsx`, `.csv` | $\le$ 16 MB | **"Upload Document"** | Clean document chip, filename label, and external view link |

#### Variable Contiguity Rules:
- Variables must follow contiguous indexing: `{{1}}`, `{{2}}`, `{{3}}`. Non-contiguous sequences (e.g. `{{1}}`, `{{3}}`) are automatically rejected by validation.

---

### 5.4 Central Template Moderation & Multi-Tier Approval (`/admin/templates`)

```mermaid
sequenceDiagram
    autonumber
    actor PA as Project Admin
    participant TplMgr as Template Manager (template-manager.tsx)
    participant Storage as Supabase Storage ('chat-media')
    participant DB as PostgreSQL DB (templates)
    actor SA as Super Admin
    participant AdminUI as Super Admin Review Queue (/admin/templates)

    PA->>TplMgr: Build Template & Click "Upload Video / Document"
    TplMgr->>Storage: uploadAccountMedia('chat-media', file)
    Storage-->>TplMgr: Public / Signed Media URL
    PA->>TplMgr: Click "Submit for Review"
    TplMgr->>DB: INSERT into templates (status='PENDING', media_url, header_type)
    
    SA->>AdminUI: Open /admin/templates
    AdminUI->>DB: SELECT * FROM templates WHERE status='PENDING'
    AdminUI-->>SA: Display Pending Queue with Video Player & Document Chip
    
    alt One-Click Project Approval
        SA->>AdminUI: Click "Approve (Project)"
        AdminUI->>DB: UPDATE templates SET status='APPROVED' WHERE id=tpl_id
    else Platform-Wide Common Template Approval
        SA->>AdminUI: Click "Approve as Common"
        AdminUI->>DB: UPDATE templates SET status='APPROVED', is_common=true
        Note over DB: Template becomes accessible across ALL projects in the account
    else Rejection with Policy Feedback
        SA->>AdminUI: Select Reason ("Promotional Content in Utility") & Click Reject
        AdminUI->>DB: UPDATE templates SET status='REJECTED', rejection_reason=reason
    end
```

---

### 5.5 Contacts & Lead Lifecycle Management

- **Contact Profiles**: Unified profile tracking phone, email, company, active deals, tags, notes, and conversation timelines.
- **Custom Attributes**: Flexible schema supporting text, numbers, dates, dropdowns, and booleans.
- **CSV Ingestion**: Bulk importer with column auto-detection, E.164 phone normalization, and duplicate handling.
- **Bulk WhatsApp Contact Sync**: One-click sync from paired WhatsApp mobile devices.
- **Contact Cleanup Safeguard**: Removes passive address book syncs while 100% preserving active leads.

---

### 5.6 Deals Kanban Sales Pipeline & 1-Click WhatsApp Outreach

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│   Lead In (3)    │  Contacted (2)   │ Proposal Sent (1)│   Won / Closed   │
│ ┌──────────────┐ │ ┌──────────────┐ │ ┌──────────────┐ │ ┌──────────────┐ │
│ │ Global Corp  │ │ │ TechFlow Ltd │ │ │ Acme Services│ │ │ Zenith Group │ │
│ │ $5,000       │ │ │ $12,000      │ │ │ $35,000      │ │ │ $50,000      │ │
│ │ 🟢 [WhatsApp]│ │ │ 🟢 [WhatsApp]│ │ │ 🟢 [WhatsApp]│ │ │ 🟢 [WhatsApp]│ │
│ └──────────────┘ │ └──────────────┘ │ └──────────────┘ │ └──────────────┘ │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

#### Pipeline Highlights:
1. **Interactive Deal Cards**: Every deal card features an interactive **WhatsApp Icon**. Clicking it immediately jumps into the customer's chat thread in the inbox.
2. **In-Chat Pipeline Stage Changer**: Sales agents can alter pipeline stages directly from the inbox contact sidebar without context switching.
3. **Automated Lead Ingestion**: Incoming WhatsApp inquiries or campaign email replies automatically instantiate contacts and pipeline deal cards.

---

### 5.7 Visual Automation Flow Builder & Human Handoff Engine

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer
    participant Flow as Visual Flow Execution Engine
    participant DB as PostgreSQL DB
    actor Agent as Human Agent
    participant Inbox as Unified Inbox

    Customer->>Flow: Inbound WhatsApp Message ("QUOTE")
    Flow->>DB: Check Active Flow for Keyword Match
    Flow->>Flow: Evaluate Condition: Business Hours?
    alt Within Business Hours
        Flow->>Customer: Dispatch Catalog Template with PDF Document
        Flow->>DB: Add Tag 'Catalog-Sent'
    else After Hours
        Flow->>Customer: Send Auto-Reply ("We are closed. Our team will contact you at 9am.")
    end

    Customer->>Inbox: Inbound Reply: "I want to speak with someone"
    Agent->>Inbox: Agent types manual response or claims conversation
    Inbox->>DB: UPDATE conversations SET auto_paused_until = now() + 24 hours
    Note over Flow: Flow engine detects human intervention and AUTO-PAUSES bot triggers
```

---

### 5.8 AI Knowledge Base & RAG Engine (`pgvector`)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Workspace Admin
    participant KB as Knowledge Base UI
    participant Embed as Embedding Service (OpenAI / Ollama)
    participant PG as PostgreSQL (pgvector)
    actor Lead as Customer
    participant RAG as RAG Answer Engine

    Admin->>KB: Upload Company PDF / FAQ Doc
    KB->>KB: Extract Text & Split into Chunks (500-1000 tokens)
    KB->>Embed: Generate 1536-dim Embeddings
    Embed-->>KB: Vector Arrays
    KB->>PG: INSERT into document_chunks (content, embedding)

    Lead->>RAG: Inbound Question: "What are your warranty terms?"
    RAG->>Embed: Embed Customer Query
    Embed-->>RAG: Query Vector
    RAG->>PG: Cosine Similarity Query (embedding <=> query_vector ORDER BY score LIMIT 3)
    PG-->>RAG: Top-3 Matching Document Chunks
    RAG->>RAG: Assemble Grounded System Prompt + Context
    RAG-->>Lead: Grounded, Accurate Answer via WhatsApp
    Note over RAG: Safety Cap: Max 3 auto-replies before escalating to human agent
```

---

### 5.9 Multi-Channel Broadcast Campaigns & Jitter Rate Limiting

- **Dynamic Audience Segmentation**: Filter recipients by tags, custom attributes, or CSV lists.
- **Template Personalization**: Injects customer names and variables into approved templates.
- **Media Header Attachments**: Dispatches approved images, videos, or PDF catalogs.
- **Jitter Rate Limiting**: Applies randomized delays (1.5s–3.0s) between outbound dispatches to protect WhatsApp phone reputation and prevent spam bans.
- **Delivery Telemetry**: Tracks real-time counts for **Sent**, **Delivered**, **Read**, and **Replies**.

---

### 5.10 Mobile Compatibility Suite & Responsive Architecture

- **Safe-Area Notch Adaptation**: Configured with `viewportFit: "cover"` to respect modern iPhone notches and Android system bars.
- **Responsive Navigation Drawer**: Full navigation drawer with an embedded Project Switcher, auto-closing links, and touch-target hitboxes ($\ge$36–44px).
- **Mobile Contact Details Sheet**: Smooth slide-out sheet inside the mobile inbox for full contact management and pipeline updates.
- **iOS Safari Auto-Zoom Prevention**: Minimum 16px typography on inputs and textareas prevents intrusive screen zoom jumps on focus.

---

## 6. Super Admin Platform Governance & Telemetry

Super Administrators hold global oversight accessible via the `/admin` portal:
- **Tenant Management**: Provision accounts, configure project boundaries, and manage license quotas.
- **Central Template Queue (`/admin/templates`)**: Review all submitted templates with embedded multimedia previewers and 1-click project or common approval.
- **Security Audit Logs**: Comprehensive audit trail of role transitions, project mutations, and login sessions.

---

## 7. Security, Cryptography & Compliance

| Security Domain | Architecture & Standard |
| :--- | :--- |
| **Credential Encryption** | WhatsApp QR sessions, API keys, and SMTP passwords encrypted at rest using **AES-256-GCM** via server-side `ENCRYPTION_KEY`. |
| **Row Level Security (RLS)** | Enabled on all PostgreSQL tables. Ensures callers only access data where `account_id` and `project_id` match their authenticated session. |
| **SSR Cookie Authentication** | Next.js Server Components and API routes read secure `HttpOnly` Supabase session cookies (`sb-<ref>-auth-token`). |
| **Webhook Verification** | Inbound Meta Graph webhooks validated via `X-Hub-Signature-256` HMAC-SHA256. QR Gateway webhooks verified via `WHATSAPP_GATEWAY_SIGNING_SECRET`. |
| **SSRF Protection** | Outbound webhook dispatchers validate target hosts, blocking loopback and private subnets (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, AWS/GCP metadata endpoints). |
| **Audit Trails** | All user onboarding, role changes, project mutations, and deletions recorded in `security_audit_logs`. |

---

## 8. Database Schema Dictionary

### Core Tables & Relationships

```
┌─────────────────┐       ┌─────────────────┐       ┌────────────────────────┐
│    accounts     │───1:N─│    projects     │───1:N─│    project_members     │
└─────────────────┘       └─────────────────┘       └────────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐       ┌────────────────────────┐
│    contacts     │───1:N─│  conversations  │───1:N─│        messages        │
└─────────────────┘       └─────────────────┘       └────────────────────────┘
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐       ┌────────────────────────┐
│      deals      │       │  email_configs  │       │       templates        │
└─────────────────┘       └─────────────────┘       └────────────────────────┘
```

| Table Name | Primary Key | Critical Fields & Foreign Keys | Purpose |
| :--- | :--- | :--- | :--- |
| `accounts` | `id` (UUID) | `name`, `status`, `created_at` | Top-level billing and organization entity |
| `projects` | `id` (UUID) | `account_id` (FK), `name`, `status` | Core multi-tenant data isolation boundary |
| `project_members` | `id` (UUID) | `project_id`, `user_id`, `role`, `is_default_admin` | RBAC mapping and Default Admin protection |
| `contacts` | `id` (UUID) | `project_id`, `name`, `phone`, `email`, `company` | Customer directory profiles |
| `conversations` | `id` (UUID) | `project_id`, `contact_id`, `status`, `snoozed_until` | Messaging thread sessions and SLA snooze state |
| `messages` | `id` (UUID) | `conversation_id`, `sender_type`, `content`, `media_url` | Inbound and outbound message records |
| `templates` | `id` (UUID) | `project_id`, `name`, `header_type`, `media_url`, `status` | WhatsApp and omnichannel message templates |
| `deals` | `id` (UUID) | `project_id`, `contact_id`, `stage_id`, `value`, `currency` | Kanban pipeline sales opportunities |
| `email_configs` | `id` (UUID) | `project_id` (UNIQUE), `host`, `port`, `user`, `pass_enc` | Dedicated project SMTP credentials (AES encrypted) |
| `email_campaign_recipients` | `id` (UUID) | `campaign_id`, `contact_id`, `opened_at`, `clicked_at` | Granular tracking logs for email campaigns |
| `qr_sessions` | `id` (UUID) | `project_id`, `creds_enc`, `keys_enc`, `status` | Encrypted Baileys WhatsApp Web credentials |
| `document_chunks` | `id` (UUID) | `project_id`, `content`, `embedding` (vector(1536)) | pgvector knowledge embeddings for AI RAG |

---

## 9. REST API & Webhook Specifications

### 9.1 Authentication
All programmatic requests must include a Bearer API token generated in **Settings $\to$ API Keys**:
```http
Authorization: Bearer msa_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 9.2 Key API Endpoints

#### 1. Outbound Message Dispatch
```http
POST /api/v1/messages
Content-Type: application/json

{
  "to": "+15551234567",
  "channel": "whatsapp_qr",
  "type": "text",
  "content": "Hello! Your proposal is ready."
}
```

#### 2. Media Template Outbound Dispatch
```http
POST /api/v1/messages
Content-Type: application/json

{
  "to": "+15551234567",
  "channel": "whatsapp_qr",
  "type": "template",
  "templateName": "product_brochure",
  "parameters": ["Alex", "Q4 Specials"],
  "mediaUrl": "https://twpuqntljgavimlocplg.supabase.co/storage/v1/object/public/chat-media/catalog.pdf"
}
```

#### 3. Contact Cleanup Trigger
```http
POST /api/contacts/cleanup-synced
Content-Type: application/json

{
  "projectId": "8b57fb05-7ae1-48fe-89aa-59e51cce26be"
}
```

**Response**:
```json
{
  "success": true,
  "deletedCount": 240,
  "keptCount": 45,
  "totalBefore": 285
}
```

---

## 10. End-to-End Operational Walkthrough (The 5-Step Revenue Lifecycle)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 5-STEP REVENUE LIFECYCLE                          │
│                                                                             │
│  [1. Connect]    Scan QR code in Settings -> Status turns Live Green.       │
│         │                                                                   │
│  [2. Capture]    Customer messages on WhatsApp -> Auto-Lead created in CRM. │
│         │                                                                   │
│  [3. Triage]     AI responds using PDF Docs OR Agent claims chat in Inbox.  │
│         │                                                                   │
│  [4. Pipeline]   Agent updates deal stage to "Proposal Sent" in chat panel. │
│         │                                                                   │
│  [5. Nurture]    Send targeted WhatsApp & Email Broadcasts with media PDF.  │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Step 1: Onboard & Connect Channel**:
   - Super Admin provisions account and project.
   - Project Admin opens **Settings $\to$ WhatsApp**, scans QR code with phone, connected in 10 seconds.
2. **Step 2: Automated Lead Capture**:
   - Inbound prospect sends: *"Hi, can I get your latest catalog?"*
   - Real-time webhook captures inquiry, dings in the **Unified Inbox**, and instantiates a deal card in the **Sales Pipeline**.
3. **Step 3: Team Collaboration & Triage**:
   - Agent clicks **"Claim"** to take ownership.
   - Types `/` to insert `/catalog` quick reply.
   - Leaves an internal note: *"Customer has a $20k budget for Q4"*.
4. **Step 4: Pipeline Advancement**:
   - Agent updates stage to `Proposal Sent` with `$20,000` value directly from the in-chat contact panel.
5. **Step 5: Multi-Channel Nurturing**:
   - Two weeks later, team launches a WhatsApp Broadcast targeting `Q4 Leads`.
   - Sends an approved **Document Template** attaching the new product catalog PDF.
   - Customer clicks the interactive button, replies, and the deal is closed.

---

## 11. Developer Quick Start & Operations Guide

### 11.1 Local Development Setup

#### 1. Prerequisites
- **Node.js**: v20+ or v24 LTS
- **Package Manager**: `npm`
- **Database**: PostgreSQL with Supabase credentials

#### 2. Start Application Server (Port 3000)
```bash
npm install
npm run dev
```

#### 3. Start WhatsApp Baileys Gateway (Port 8088)
```bash
cd gateway
npm install
npm run dev
```

---

## 12. Verification, Quality Assurance & Test Matrix

- **TypeScript Compilation**: `0 errors` (`tsc --noEmit`).
- **Vitest Unit & Integration Suites**: **71 test suites / 762 automated tests passing**.
- **Email Flow & Isolation Suite**: Validates project email isolation, merge tag replacement, open/click tracking URLs, and preset configurations.
- **End-to-End Live Workflow**: Validated across all 11 core CRM operations (Authentication, Protected Default Admin, Team Role Management, Project SMTP, Contact Cleanup, Unified Inbox, QR Gateway, Templates, Campaigns, and Readiness).

---

*Documentation maintained by the CloudMaSa Engineering Team • CloudMaSa CRM (MaSa CRM).*

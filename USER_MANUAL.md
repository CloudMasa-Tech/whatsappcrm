# CloudMaSa CRM (MaSa CRM)
# 📘 Comprehensive End-to-End Operations & User Manual

---

## 📑 Table of Contents

1. [Platform Overview & Architecture](#1-platform-overview--architecture)
   - [1.1 Product Vision](#11-product-vision)
   - [1.2 High-Level System Architecture](#12-high-level-system-architecture)
   - [1.3 Multi-Tenant Project Hierarchy & RBAC](#13-multi-tenant-project-hierarchy--rbac)
2. [Getting Started & Authentication](#2-getting-started--authentication)
   - [2.1 Logging In & Magic Links](#21-logging-in--magic-links)
   - [2.2 Workspace Navigation & Project Switcher](#22-workspace-navigation--project-switcher)
   - [2.3 Mobile Navigation & Responsive Experience](#23-mobile-navigation--responsive-experience)
3. [Connecting Channels & Gateways](#3-connecting-channels--gateways)
   - [3.1 WhatsApp Web QR Gateway (Instant 10-Second Pairing)](#31-whatsapp-web-qr-gateway-instant-10-second-pairing)
   - [3.2 Meta WhatsApp Cloud API Integration](#32-meta-whatsapp-cloud-api-integration)
   - [3.3 Instagram Direct & Facebook Messenger](#33-instagram-direct--facebook-messenger)
   - [3.4 Dedicated Project SMTP Email Gateways](#34-dedicated-project-smtp-email-gateways)
4. [Mastering the Collaborative Team Inbox](#4-mastering-the-collaborative-team-inbox)
   - [4.1 Real-Time Multi-Agent Chat Streaming](#41-real-time-multi-agent-chat-streaming)
   - [4.2 Agent Tabs & 1-Click Self-Claiming](#42-agent-tabs--1-click-self-claiming)
   - [4.3 SLA Snooze Follow-Ups & Live Countdown](#43-sla-snooze-follow-ups--live-countdown)
   - [4.4 Private Team Notes (Internal Collaboration)](#44-private-team-notes-internal-collaboration)
   - [4.5 Slash Quick Replies (`/`) & Smart Drafts](#45-slash-quick-replies--and-smart-drafts)
   - [4.6 Mobile Slide-Out Contact Details Sheet](#46-mobile-slide-out-contact-details-sheet)
5. [Message Templates & Rich Media Submissions](#5-message-templates--rich-media-submissions)
   - [5.1 Template Formats: Text, Image, Video, Document](#51-template-formats-text-image-video-document)
   - [5.2 Direct File Uploads & In-Modal Previews](#52-direct-file-uploads--in-modal-previews)
   - [5.3 Contiguous Variables & Interactive Buttons](#53-contiguous-variables--interactive-buttons)
   - [5.4 Project Admin Submission vs Super Admin Moderation](#54-project-admin-submission-vs-super-admin-moderation)
   - [5.5 Ready-Made Starter Templates Library](#55-ready-made-starter-templates-library)
6. [Contact Directory & Smart Lifecycle Sync](#6-contact-directory--smart-lifecycle-sync)
   - [6.1 Contact Profiles & Custom Fields](#61-contact-profiles--custom-fields)
   - [6.2 CSV Import & Tag Segmentation](#62-csv-import--tag-segmentation)
   - [6.3 Bulk WhatsApp Contact Sync](#63-bulk-whatsapp-contact-sync)
   - [6.4 "Clean Synced Contacts" Safeguard](#64-clean-synced-contacts-safeguard)
7. [Sales Pipelines & Deals (Kanban)](#7-sales-pipelines--deals-kanban)
   - [7.1 Visual Pipeline Stages & Drag-and-Drop](#71-visual-pipeline-stages--drag-and-drop)
   - [7.2 1-Click WhatsApp Outreach from Deal Cards](#72-1-click-whatsapp-outreach-from-deal-cards)
   - [7.3 In-Chat Pipeline Stage Changer](#73-in-chat-pipeline-stage-changer)
   - [7.4 Automated Lead Creation from Incoming Inquiries](#74-automated-lead-creation-from-incoming-inquiries)
8. [Visual Automation Flow Builder](#8-visual-automation-flow-builder)
   - [8.1 Canvas Overview & Node Types](#81-canvas-overview--node-types)
   - [8.2 Inbound Triggers & Keyword Routing](#82-inbound-triggers--keyword-routing)
   - [8.3 Automated Actions & Outbound Webhooks](#83-automated-actions--outbound-webhooks)
   - [8.4 Human Handoff & Auto-Pause Logic](#84-human-handoff--auto-pause-logic)
9. [AI Knowledge Base & Document RAG](#9-ai-knowledge-base--document-rag)
   - [9.1 Uploading Documents & Vector Embeddings](#91-uploading-documents--vector-embeddings)
   - [9.2 Semantic Context Retrieval (`pgvector`)](#92-semantic-context-retrieval-pgvector)
   - [9.3 24/7 Auto-Pilot Responders & Safety Caps](#93-247-auto-pilot-responders--safety-caps)
10. [Multi-Channel Broadcasts & Email Marketing](#10-multi-channel-broadcasts--email-marketing)
    - [10.1 WhatsApp Bulk Broadcast Campaigns](#101-whatsapp-bulk-broadcast-campaigns)
    - [10.2 Dynamic Personalization & Rate Limiting](#102-dynamic-personalization--rate-limiting)
    - [10.3 Dedicated Project Email Campaigns & Tracking](#103-dedicated-project-email-campaigns--tracking)
11. [Super Admin Console & Global Governance](#11-super-admin-console--global-governance)
    - [11.1 Global Tenant & Project Provisioning](#111-global-tenant--project-provisioning)
    - [11.2 Central Template Moderation (`/admin/templates`)](#112-central-template-moderation-admintemplates)
    - [11.3 User Audit & Role Management](#113-user-audit--role-management)
12. [Security, Encryption & Compliance](#12-security-encryption--compliance)
    - [12.1 PostgreSQL Row-Level Security (RLS)](#121-postgresql-row-level-security-rls)
    - [12.2 AES-256-GCM Session Key Encryption](#122-aes-256-gcm-session-key-encryption)
    - [12.3 SSRF Protection on External Media](#123-ssrf-protection-on-external-media)
13. [End-to-End Operational Walkthrough (The Complete Lifecycle)](#13-end-to-end-operational-walkthrough-the-complete-lifecycle)
14. [Troubleshooting & Frequently Asked Questions (FAQ)](#14-troubleshooting--frequently-asked-questions-faq)

---

## 1. Platform Overview & Architecture

### 1.1 Product Vision
**CloudMaSa CRM (MaSa CRM)** is an enterprise-grade, multi-tenant Omnichannel Customer Relationship Management (CRM) and Marketing Automation platform. Engineered specifically for high-velocity sales, customer support, and conversational commerce, it connects traditional customer relationship databases directly to messaging channels:
- **WhatsApp Web QR Code Connection**: Independent, lightweight Baileys multi-device socket gateway requiring zero Meta Business verification.
- **Meta WhatsApp Cloud API**: Official WhatsApp Business Platform with template sync and webhook delivery.
- **Social Inboxes**: Instagram Direct & Facebook Messenger synchronized into a single unified stream.
- **Dedicated Project Email Gateway**: Independent SMTP engine per project (Gmail, Outlook, Zoho, Custom SMTP) with open/click tracking.
- **Visual Automation Flow Builder**: Drag-and-drop node canvas for triggers, conditions, branching, and human handoff.
- **AI Knowledge Base (RAG Engine)**: Context-aware conversational AI grounded on company documents, PDFs, and FAQs via `pgvector`.
- **Deals & Kanban Sales Pipelines**: Visual stage tracking with 1-click WhatsApp outreach.

---

### 1.2 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT WORKSTATIONS                             │
│       Desktop Web App  •  Tablet Viewports  •  Mobile PWA (iOS/Android)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS / WSS
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER (Next.js 16 - Port 3000)               │
│  ┌───────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ App Router SSR / API  │  │ Visual Flow Engine   │  │ Project SMTP     │  │
│  │ Auth & Context Guards │  │ Webhook Dispatche    │  │ Mailer Engine    │  │
│  └───────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
└──────────────┼─────────────────────────┼───────────────────────┼────────────┘
               │                         │                       │
     Signed Webhooks                     ▼                       ▼
               ▼                ┌─────────────────┐    ┌─────────────────┐
┌──────────────────────────────┐│   META GRAPH    │    │  SMTP SERVERS   │
│  WHATSAPP QR GATEWAY (8088)  ││ (Cloud API, IG) │    │(Gmail, O365, etc│
│  Baileys Multi-Device Socket │└─────────────────┘    └─────────────────┘
│  AES-256-GCM Session Storage │
│  SSE Live QR Streamer        │
└──────────────┬───────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SUPABASE INFRASTRUCTURE LAYER                        │
│  PostgreSQL 15+ (Row-Level Security) • pgvector Embeddings • Media Storage  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 1.3 Multi-Tenant Project Hierarchy & RBAC

The platform utilizes a two-tier tenancy hierarchy:

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

#### Roles & Permissions Matrix

| Capability / Action | Super Admin | Default Admin (`default_admin`) | Project Admin | Agent |
| :--- | :---: | :---: | :---: | :---: |
| Access Global Platform `/admin` | ✅ | ❌ | ❌ | ❌ |
| Create / Delete Client Accounts & Projects | ✅ | ❌ | ❌ | ❌ |
| Demote / Delete Default Primary Admin | ✅ | ❌ | ❌ | ❌ |
| Switch Other Members (Agent $\leftrightarrow$ Admin) | ✅ | ✅ | ✅ | ❌ |
| Connect / Disconnect WhatsApp & Email | ✅ | ✅ | ✅ | ❌ |
| Configure Visual Automation Flows | ✅ | ✅ | ✅ | ❌ |
| Access Unified Inbox & Reply to Customers | ✅ | ✅ | ✅ | ✅ |
| Manage Deals, Kanban Stages & Contacts | ✅ | ✅ | ✅ | ✅ |
| Create & Dispatch WhatsApp Broadcasts | ✅ | ✅ | ✅ | ❌ |

---

## 2. Getting Started & Authentication

### 2.1 Logging In & Magic Links
1. Navigate to your application URL (`https://crm.yourdomain.com/login`).
2. **Email & Password**: Enter credentials provided by your workspace administrator.
3. **Magic Link / OTP**: Team members invited via invitation links receive an instant authentication link verified via Supabase Auth without entering passwords.

### 2.2 Workspace Navigation & Project Switcher
- The top header houses the **Project Switcher Dropdown**.
- Selecting a project immediately updates your session cookie (`masacrm_project`).
- All data—including chats, templates, campaigns, deals, and team presence—dynamically re-scopes to the chosen project boundary.

### 2.3 Mobile Navigation & Responsive Experience
- **Notch Safe Areas**: Enhanced `viewportFit: "cover"` eliminates letterboxing on iOS and Android devices.
- **Mobile Project Switcher**: Located inside the sliding hamburger navigation drawer right under the brand header.
- **iOS Auto-Zoom Prevention**: Text inputs and message composers maintain a minimum 16px font size, preventing Safari from zooming the screen on tap.
- **Touch-Friendly Hitboxes**: All action buttons meet Apple HIG and Google Material guidelines (minimum 36–44px).

---

## 3. Connecting Channels & Gateways

### 3.1 WhatsApp Web QR Gateway (Instant 10-Second Pairing)
Connect your WhatsApp number without Meta Business verification:
1. In the sidebar, navigate to **Settings** $\rightarrow$ **WhatsApp**.
2. Select **Channel: WhatsApp Web (QR Gateway)**.
3. Click **"Generate QR Code"** or **"Connect"**.
4. Open WhatsApp on your smartphone:
   - **Android**: Tap the 3 dots $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
   - **iPhone (iOS)**: Go to **Settings** $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
5. Point your camera at the QR code on your screen.
6. The status indicator immediately turns green: **Connected (Live)**.
7. The gateway maintains a persistent background socket with automatic exponential backoff reconnection.

### 3.2 Meta WhatsApp Cloud API Integration
For official Meta WhatsApp Cloud API deployments:
1. Navigate to **Settings** $\rightarrow$ **WhatsApp** $\rightarrow$ select **Cloud API**.
2. Enter your **Phone Number ID**, **WhatsApp Business Account ID (WABA ID)**, and **Permanent System User Access Token**.
3. Copy the **Webhook URL** and **Verify Token** into your **Meta Developer App Dashboard**.
4. Test outbound delivery to verify verified delivery status.

### 3.3 Instagram Direct & Facebook Messenger
1. In **Settings**, navigate to **Instagram / Facebook**.
2. Input your Meta Page ID, Instagram Business Account ID, and Page Access Token.
3. Messages, comments, and direct mentions will immediately stream into the Unified Inbox alongside WhatsApp.

### 3.4 Dedicated Project SMTP Email Gateways
Each project can bind its own distinct outgoing and incoming mail server:
1. Navigate to **Settings** $\rightarrow$ **Email Configuration**.
2. Select a preset: **Gmail**, **Outlook / Office 365**, **Zoho Mail**, or **Custom SMTP**.
3. Enter your SMTP Host, Port, Username, App Password, and Sender Display Name.
4. Click **"Test Connection"** to verify deliverability.
5. All broadcast campaigns sent from this project will originate from this dedicated server.

---

## 4. Mastering the Collaborative Team Inbox

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

### 4.1 Real-Time Multi-Agent Chat Streaming
- Inbound messages trigger instant audio chimes and real-time tab badge updates.
- Supports two-way synchronization of **Text, Images, Audio/Voice Notes, Videos, Documents, and Location Pins**.

### 4.2 Agent Tabs & 1-Click Self-Claiming
- **All Chats**: Organization-wide chronological inbox.
- **My Assigned**: Conversations explicitly owned by the logged-in agent.
- **Unassigned**: New inbound conversations needing triage. Agents click **"Claim"** with one tap to take ownership.
- **Pending / Snoozed**: Chats placed on hold awaiting customer responses.

### 4.3 SLA Snooze Follow-Ups & Live Countdown
- Click the **Snooze (Clock)** icon in any conversation.
- Choose **1 Hour**, **3 Hours**, **24 Hours**, or **Custom Time**.
- The chat moves into `pending` status, decluttering the active queue.
- A live countdown timer is displayed. When time expires, the conversation **automatically unsnoozes** back into `open` status with an alert.

### 4.4 Private Team Notes (Internal Collaboration)
- Click the **"Internal Note"** toggle below the composer input.
- Enter team notes rendered as bright yellow cards.
- Notes are strictly internal: agents can document phone summaries, discount approvals, or handoff notes without the customer ever seeing them.

### 4.5 Slash Quick Replies (`/`) & Smart Drafts
- Type `/` into the composer to bring up instant canned replies (e.g. `/pricing`, `/onboarding`, `/meeting`).
- Press **Tab** or **Enter** to insert the template text.
- Click **"Draft with AI"** to generate polite, contextual responses grounded in past chat history.

### 4.6 Mobile Slide-Out Contact Details Sheet
- On mobile devices (<640px), tapping the customer header opens a smooth slide-out sheet.
- Agents can view contact details, edit custom fields, add tags, and move sales pipeline stages without leaving their mobile screen.

---

## 5. Message Templates & Rich Media Submissions

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

### 5.1 Template Formats: Text, Image, Video, Document
Templates support four distinct header formats:
1. **None**: Pure text body, optional footer, and action buttons.
2. **Text**: Header title with optional `{{1}}` dynamic replacement.
3. **Image**: High-resolution graphic header (JPEG/PNG up to 5 MB).
4. **Video**: Embedded video presentation header (MP4/3GP up to 16 MB).
5. **Document**: Digital brochure, invoice, or catalog header (PDF, DOCX, XLSX, CSV up to 16 MB).

### 5.2 Direct File Uploads & In-Modal Previews
- **Direct Upload Buttons**: When `image`, `video`, or `document` is selected, the dialog displays an **Upload** button to pick files directly from your computer.
- Files are securely stored in the `chat-media` cloud storage bucket.
- **In-Modal Previews**:
  - **Images**: Displays the rendered thumbnail.
  - **Videos**: Renders an embedded, playable `<video>` player.
  - **Documents**: Displays a document badge with the clean filename and an external **"View"** link.
- **Quick Clear (`✕`)**: A one-click clear button resets the attachment if you wish to swap it.

### 5.3 Contiguous Variables & Interactive Buttons
- **Dynamic Variables**: Use `{{1}}`, `{{2}}` syntax. Placeholders must be contiguous starting from 1.
- **Action Buttons**:
  - **Quick Reply**: Pre-configured response chips.
  - **URL Button**: External website links with dynamic parameter substitution (e.g. `https://shop.com/orders/{{1}}`).
  - **Phone Call**: Direct click-to-dial telephone link.
  - **Copy Code**: One-tap promo code clipboard copy.

### 5.4 Project Admin Submission vs Super Admin Moderation
- **Project Admin**: Submits a template $\rightarrow$ Enters `PENDING` review status.
- **Super Admin**: Reviews the template in `/admin/templates` with live media playback, approves it (for project or common use), or rejects it with pre-set policy reasons.

### 5.5 Ready-Made Starter Templates Library
Click **"Browse Ready-Made Templates"** to install pre-built, high-converting templates for Welcome Greetings, Order Confirmations, Appointment Reminders, and Feedback Requests.

---

## 6. Contact Directory & Smart Lifecycle Sync

### 6.1 Contact Profiles & Custom Fields
- Each contact card maintains a complete audit trail: WhatsApp conversation timeline, pipeline deals, active tags, and custom fields.
- Create custom attributes under **Settings** $\rightarrow$ **Custom Fields** (e.g. *Lead Source*, *Annual Revenue*, *Subscription Tier*).

### 6.2 CSV Import & Tag Segmentation
- Upload bulk CSV spreadsheets mapping names, international phone numbers, and comma-separated tags.
- Tag groups allow instant segmentation when dispatching marketing broadcasts.

### 6.3 Bulk WhatsApp Contact Sync
- Located in **Settings** $\rightarrow$ **WhatsApp** $\rightarrow$ **"Sync Contacts"**.
- Queries your linked WhatsApp device and imports all chat contacts in bulk into your CRM directory with a single click.

### 6.4 "Clean Synced Contacts" Safeguard
When pairing a mobile number, personal address book contacts can sync into the database.
- Click **"Clean Synced Contacts"** in the contacts toolbar.
- The system automatically purges passive address book contacts while **guaranteeing 100% protection** for any contact that has active chats, notes, deals, or tags.

---

## 7. Sales Pipelines & Deals (Kanban)

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

### 7.1 Visual Pipeline Stages & Drag-and-Drop
- Track revenue velocity visually across customizable sales stages.
- Drag and drop deal cards smoothly between columns with real-time value aggregations.

### 7.2 1-Click WhatsApp Outreach from Deal Cards
- Every deal card features an interactive **WhatsApp Icon**.
- Clicking it immediately launches the live conversation in the inbox, enabling sales reps to follow up instantly.

### 7.3 In-Chat Pipeline Stage Changer
- While chatting in the inbox, sales agents can update the customer's deal stage directly from the right-hand sidebar without leaving the conversation.

### 7.4 Automated Lead Creation from Incoming Inquiries
- Enable **Auto-Lead Capture** in Pipeline Settings.
- When an unknown customer sends an inbound WhatsApp message or replies to an email campaign, a new contact and deal card are automatically created in the `Lead In` stage.

---

## 8. Visual Automation Flow Builder

```
┌─────────────────────────────────────────────────────────────┐
│                    Visual Flow Canvas                       │
│                                                             │
│   ┌─────────────────────┐                                   │
│   │ Trigger: Inbound Msg│                                   │
│   │ Keyword = "PRICING" │                                   │
│   └──────────┬──────────┘                                   │
│              ▼                                              │
│   ┌─────────────────────┐      ┌─────────────────────────┐  │
│   │ Condition: Is VIP?  │─YES─▶│ Action: Assign to Sarah │  │
│   └──────────┬──────────┘      └─────────────────────────┘  │
│              │ NO                                           │
│              ▼                                              │
│   ┌─────────────────────────┐                               │
│   │ Action: Send PDF Catalog│                               │
│   └─────────────────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

### 8.1 Canvas Overview & Node Types
- **Trigger Nodes**: What starts the automation.
- **Condition Nodes**: Branching logic based on text, business hours, or customer tags.
- **Action Nodes**: Automated steps performed by the system.
- **Integration Nodes**: External webhook triggers and REST API dispatches.

### 8.2 Inbound Triggers & Keyword Routing
- Trigger workflows when incoming WhatsApp messages match exact words or phrases (e.g. `"quote"`, `"support"`, `"catalog"`).

### 8.3 Automated Actions & Outbound Webhooks
- Automatically send rich templates, attach PDF documents, assign specific agents, or trigger Zapier/Make webhooks.

### 8.4 Human Handoff & Auto-Pause Logic
- When an agent types a response or claims a conversation in the inbox, active automations **automatically pause** to prevent bot collisions with human agents.

---

## 9. AI Knowledge Base & Document RAG

### 9.1 Uploading Documents & Vector Embeddings
- Navigate to **Agents / AI** $\rightarrow$ **Knowledge Base**.
- Upload company brochures, FAQ sheets, price lists, or policy documents (PDF, DOCX, TXT).
- The system chunks documents and generates vector embeddings stored in PostgreSQL via `pgvector`.

### 9.2 Semantic Context Retrieval (`pgvector`)
- When a customer asks a question on WhatsApp, the engine performs a semantic cosine similarity search against your documents to retrieve the exact factual excerpt.

### 9.3 24/7 Auto-Pilot Responders & Safety Caps
- The AI crafts an accurate, polite answer based strictly on your source documents.
- **Safety Caps**: Limits consecutive automated AI answers to 3 messages before triggering a human agent notification.

---

## 10. Multi-Channel Broadcasts & Email Marketing

### 10.1 WhatsApp Bulk Broadcast Campaigns
1. Navigate to **Broadcasts** $\rightarrow$ **"New Broadcast"**.
2. **Step 1 (Setup)**: Name your campaign and select your approved message template.
3. **Step 2 (Audience)**: Filter recipients by tags, custom fields, or upload a CSV file.
4. **Step 3 (Personalize)**: Review dynamic variables (`{{1}}` = First Name). For media templates, verify or override the attached image, video, or PDF document.
5. **Step 4 (Schedule & Review)**: Dispatch immediately or schedule for a future date and time.

### 10.2 Dynamic Personalization & Rate Limiting
- **Delivery Pacing**: The gateway applies a random jitter delay (1.5s–3s) between outbound messages to protect your WhatsApp number reputation.
- Real-time telemetry tracks: **Sent**, **Delivered**, **Read**, and **Replies**.

### 10.3 Dedicated Project Email Campaigns & Tracking
- Compose rich HTML marketing emails using your project's custom SMTP server.
- Automatic insertion of tracking pixels and redirect links monitors **Open Rates** and **Link Clicks** in real time.

---

## 11. Super Admin Console & Global Governance

### 11.1 Global Tenant & Project Provisioning
Super Administrators have dedicated access to the `/admin` portal:
- Create and provision independent client organizations (`accounts`).
- Spin up isolated workspaces (`projects`) with dedicated channel quotas.
- View system-wide throughput and database health telemetry.

### 11.2 Central Template Moderation (`/admin/templates`)
- Reviews all message templates submitted by Project Admins across the entire platform.
- Full multimedia review: inspect images, play videos, and download PDF documents before approval.
- **One-Click Approval**: Approve for the submitting project or approve as a **"Common Template"** accessible by all projects.
- **Rejection Presets**: Pre-populated policy feedback (e.g. *Promotional content in utility category*, *Missing sample values*).

### 11.3 User Audit & Role Management
- Global visibility of all registered users, roles, project assignments, and security audit logs.
- Safeguards protect the **Designated Default Admin** from accidental deletion.

---

## 12. Security, Encryption & Compliance

### 12.1 PostgreSQL Row-Level Security (RLS)
- Every database query passes through Supabase RLS policies evaluating `is_project_member(project_id, role)`.
- Cross-organization and cross-project data leakage is structurally impossible at the database engine level.

### 12.2 AES-256-GCM Session Key Encryption
- WhatsApp session keys, Meta API tokens, and SMTP email credentials are encrypted at rest using AES-256-GCM.

### 12.3 SSRF Protection on External Media
- All outbound media fetches use server-side validation rejecting private, loopback, link-local, and reserved IP addresses.

---

## 13. End-to-End Operational Walkthrough (The Complete Lifecycle)

Here is how the entire system functions together in a real-world enterprise scenario:

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

1. **Step 1: Onboard & Pair**
   - Super Admin provisions a project (`Sales`).
   - Project Admin opens **Settings $\rightarrow$ WhatsApp**, scans the QR code with their business phone, and is connected in 10 seconds.
2. **Step 2: Customer Reaches Out**
   - A prospective client sends: *"Hi, can I get your latest catalog?"*
   - Inbound webhook captures the message; the phone dings in the **Unified Inbox**, and an automated lead is created in the **Sales Pipeline**.
3. **Step 3: Collaborate & Deliver**
   - Agent Sarah clicks **"Claim"** in the inbox.
   - She types `/` and selects the `/catalog` quick reply.
   - She switches to **"Internal Note"** and types: *"Customer has a $20k budget for Q4"*.
4. **Step 4: Track the Deal**
   - In the right-hand contact panel, Sarah drags the deal from `Lead In` to `Proposal Sent` with a value of `$20,000`.
5. **Step 5: Re-engage via Broadcast**
   - Two weeks later, the team launches a **WhatsApp Broadcast** targeting the `Q4 Leads` tag.
   - The campaign sends an approved **Document Template** attaching the new product catalog PDF.
   - The customer clicks the interactive button, replies, and Sarah closes the deal.

---

## 14. Troubleshooting & Frequently Asked Questions (FAQ)

### Q1: My WhatsApp shows "Disconnected". How do I reconnect?
- Navigate to **Settings** $\rightarrow$ **WhatsApp**.
- Click **"Reconnect"** or **"Generate QR Code"** and scan it with your smartphone under **WhatsApp $\rightarrow$ Linked Devices**.

### Q2: Can agents upload PDF documents or video clips directly into templates?
- **Yes!** When creating a template in **Settings $\rightarrow$ Message Templates**, select **Header: Document** or **Header: Video**. Direct **"Upload Document"** and **"Upload Video"** buttons allow picking files up to 16 MB directly from your computer with live previews.

### Q3: How does the "Clean Synced Contacts" feature protect my active leads?
- The cleanup algorithm queries your database and only removes contacts that have **zero conversations, zero notes, zero pipeline deals, and zero tags**. Any customer you have ever interacted with is 100% preserved.

### Q4: Can multiple agents chat with the same customer simultaneously?
- The CRM includes **Collision Prevention & Heartbeat Presence**. When an agent views or types in a conversation, an active avatar is displayed, alerting other agents that the chat is being handled.

### Q5: How do I switch between different business projects?
- Click the **Project Switcher** in the top navigation bar (or inside the mobile drawer) and choose any project you have access to. All data re-scopes instantly.

---

*Documentation maintained by CloudMaSa Engineering • CloudMaSa CRM (MaSa CRM).*

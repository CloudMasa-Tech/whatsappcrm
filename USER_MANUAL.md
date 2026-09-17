# CloudMasa WhatsApp CRM
# 📘 Official User & Administrator Operations Manual

---

## 📑 Table of Contents
1. [Introduction & Overview](#1-introduction--overview)
2. [Getting Started & Navigation](#2-getting-started--navigation)
3. [Connecting WhatsApp](#3-connecting-whatsapp)
   - [3.1 WhatsApp QR Gateway (Instant 10-Second Pairing)](#31-whatsapp-qr-gateway-instant-10-second-pairing)
   - [3.2 Meta WhatsApp Cloud API (Optional Enterprise API)](#32-meta-whatsapp-cloud-api-optional-enterprise-api)
   - [3.3 Managing Connection Status & Reconnecting](#33-managing-connection-status--reconnecting)
4. [Mastering the WhatsApp Team Inbox](#4-mastering-the-whatsapp-team-inbox)
   - [4.1 Real-Time WhatsApp Chat & Media](#41-real-time-whatsapp-chat--media)
   - [4.2 Internal Notes & Agent Collaboration](#42-internal-notes--agent-collaboration)
   - [4.3 Assigning Chats & Collision Prevention](#43-assigning-chats--collision-prevention)
   - [4.4 Quick Replies & AI Drafts](#44-quick-replies--ai-drafts)
5. [Contact Management & Smart Lifecycle](#5-contact-management--smart-lifecycle)
   - [5.1 Contact Profiles & Custom Fields](#51-contact-profiles--custom-fields)
   - [5.2 CSV Import & Segmentation Tags](#52-csv-import--segmentation-tags)
   - [5.3 Clean Synced Contacts Feature](#53-clean-synced-contacts-feature)
6. [Sales Pipelines & Deals (Kanban)](#6-sales-pipelines--deals-kanban)
7. [WhatsApp Broadcasts & Campaign Dispatch](#7-whatsapp-broadcasts--campaign-dispatch)
8. [Automations & Visual WhatsApp Flow Builder](#8-automations--visual-whatsapp-flow-builder)
9. [AI Knowledge Base & WhatsApp Auto-Replies (RAG)](#9-ai-knowledge-base--whatsapp-auto-replies-rag)
10. [Team Management & Access Control](#10-team-management--access-control)
11. [Troubleshooting & Frequently Asked Questions (FAQ)](#11-troubleshooting--frequently-asked-questions-faq)

---

## 1. Introduction & Overview

**CloudMasa WhatsApp CRM** is a dedicated multi-tenant customer relationship management, sales pipeline, and conversational marketing platform built specifically for **WhatsApp**.

### Core Capabilities:
- **Instant QR Pairing**: Connect your existing official or business WhatsApp number in 10 seconds without complicated verification delays.
- **Shared Team Inbox**: Multiple agents can manage customer WhatsApp inquiries simultaneously from a single central number.
- **Visual Drag-and-Drop Automations**: Automated WhatsApp lead qualification, keyword bots, and drip sequences.
- **Built-in Deals & Pipelines**: Track deals visually from WhatsApp lead capture to deal closed.
- **Targeted Broadcasts**: Send bulk personalized announcements with automated delivery pacing.
- **Enterprise Security**: Multi-tenant data isolation with PostgreSQL Row-Level Security (RLS) and AES-256-GCM token encryption.

---

## 2. Getting Started & Navigation

### 2.1 Logging In
1. Open your browser and navigate to your CRM URL (e.g., `https://crm.yourdomain.com/login`).
2. Enter your email and password provided by your administrator.
3. If you received an invitation link, click the link to set your password and enter your workspace directly.

### 2.2 Navigation Sidebar
The left sidebar gives quick access to the main WhatsApp CRM modules:

| Icon / Tab | Module Name | Purpose |
|---|---|---|
| 📊 | **Dashboard** | Real-time analytics, total WhatsApp message volume, active chats, and conversion rates. |
| 💬 | **Inbox** | Real-time live WhatsApp chat stream with filters and search. |
| 👥 | **Contacts** | Contact database, custom fields, tags, and import/cleanup tools. |
| 💼 | **Pipelines** | Kanban sales pipeline to manage deals, stages, and deal values. |
| 📢 | **Broadcasts** | Bulk WhatsApp messaging campaigns to targeted contact segments. |
| ⚡ | **Automations / Flows** | Visual drag-and-drop WhatsApp bot builder, auto-tagging, and keyword routing. |
| 🧠 | **Agents / AI** | AI Knowledge Base (RAG), custom document training, and 24/7 auto-reply rules. |
| 📱 | **Channels** | Connect, pair, and monitor your WhatsApp number. |
| ⚙️ | **Settings** | Team members, roles, project profile, and API key management. |

---

## 3. Connecting WhatsApp

### 3.1 WhatsApp QR Gateway (Instant 10-Second Pairing)
Connect your WhatsApp without waiting for Meta business verification:

1. In the sidebar, navigate to **Channels** $\rightarrow$ **WhatsApp Web (QR Gateway)**.
2. Select your active project (e.g. `Sales` or `Main Business`).
3. Click **"Generate QR Code"** or **"Connect"**.
4. Open WhatsApp on your mobile phone:
   - **Android**: Tap the 3 dots in the top right $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
   - **iOS (iPhone)**: Go to **Settings** $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
5. Point your phone camera at the QR code displayed on the screen.
6. The status will immediately turn green: **Connected (Live)**.

> 💡 **Tip:** The connection runs in the background. If you restart your phone or switch networks, the gateway reconnects automatically.

---

### 3.2 Meta WhatsApp Cloud API (Optional Enterprise API)
For businesses with an official Meta WhatsApp Cloud API account:
1. Navigate to **Channels** $\rightarrow$ **WhatsApp Cloud API**.
2. Enter your **Phone Number ID**, **WhatsApp Business Account ID (WABA ID)**, and **Permanent Access Token**.
3. Copy the **Webhook URL** and **Verify Token** generated by CloudMasa and paste them into your **Meta Developer Portal**.
4. Click **Save & Test Connection**.

---

### 3.3 Managing Connection Status & Reconnecting
- **Status Monitoring**: The channels tab displays the live session status (**Connected**, **Connecting**, or **Disconnected**).
- **Session Refresh**: If WhatsApp is disconnected from your mobile app, click **"Reconnect"** to generate a new QR code instantly.

---

## 4. Mastering the WhatsApp Team Inbox

```
┌─────────────────────────┬───────────────────────────────┬───────────────────────────┐
│   WhatsApp Chats List   │        Live Chat Stream       │     Contact Details       │
│  [WhatsApp] John Doe    │  [10:00] John: Hi, price?     │ Name: John Doe            │
│  [WhatsApp] Sarah M.    │  [10:01] Agent: $49/mo        │ Phone: +1 555-0199        │
│  [WhatsApp] Mike Smith  │  [10:02] [Note] Ready to buy  │ Pipeline: Qualified Lead  │
│                         │  [Type message / AI Draft...] │ Tags: [VIP] [Retail]      │
└─────────────────────────┴───────────────────────────────┴───────────────────────────┘
```

### 4.1 Real-Time WhatsApp Chat & Media
- **Rich Media**: Send and receive images, PDF documents, voice notes, videos, and emojis directly in WhatsApp threads.
- **Two-Way Sync**: Inbound and outbound WhatsApp messages appear instantly on your screen.

### 4.2 Internal Notes & Agent Collaboration
- Click the **"Internal Note"** toggle below the chat input box.
- Type notes visible **only to your team** (highlighted in yellow).
- Use notes to record customer preferences, call summaries, or special instructions without the customer seeing them.

### 4.3 Assigning Chats & Collision Prevention
- **Assign Agent**: Assign customer conversations to specific team members or leave unassigned.
- **Presence Heartbeat**: If another agent is currently viewing or typing in a conversation, an active avatar indicator appears, preventing two agents from replying simultaneously.

### 4.4 Quick Replies & AI Drafts
- **Quick Replies**: Type `/` in the message box to open saved canned responses.
- **AI Smart Draft**: Click **"Draft with AI"** to generate an instant, polite, and contextual response based on the conversation history.

---

## 5. Contact Management & Smart Lifecycle

### 5.1 Contact Profiles & Custom Fields
- View full WhatsApp conversation history, past deals, custom tags, and attached notes for each customer.
- Add custom fields (e.g. *Company Size*, *Budget*, *Renewal Date*, *Address*).

### 5.2 CSV Import & Segmentation Tags
1. Navigate to **Contacts** $\rightarrow$ **Import CSV**.
2. Upload your contact list and map CSV columns (*Name*, *Phone*, *Tags*).
3. Click **Import** to add hundreds or thousands of contacts instantly.

### 5.3 Clean Synced Contacts Feature
When pairing a new WhatsApp number, personal address book contacts may initially sync into the database.
- Navigate to **Contacts**.
- Click **"Clean Synced Contacts"** in the top right.
- This safely removes passive, unengaged address book entries while **preserving all CRM contacts** with ongoing conversations, notes, or deals.

---

## 6. Sales Pipelines & Deals (Kanban)

Track your sales process visually:
1. Navigate to **Pipelines**.
2. Click **"+ Add Deal"** on any contact to create an opportunity.
3. Drag and drop deals across stages:
   - `Lead In` $\rightarrow$ `Contact Made` $\rightarrow$ `Meeting Scheduled` $\rightarrow$ `Proposal Sent` $\rightarrow$ `Won` / `Lost`.
4. Filter pipeline by **Assignee**, **Date Range**, or **Deal Value**.

---

## 7. WhatsApp Broadcasts & Campaign Dispatch

Send bulk personalized announcements to selected audience segments:

1. Navigate to **Broadcasts** $\rightarrow$ **"New Broadcast"**.
2. Choose your target audience by **Tag** (e.g. `VIP Customers` or `Leads September`).
3. Compose your WhatsApp message using dynamic merge variables:
   ```text
   Hi {{name}}, your exclusive offer for {{company}} is now live!
   ```
4. Choose **Send Now** or **Schedule for Later**.
5. Monitor live metrics: **Total Sent**, **Delivered**, **Read**, and **Replies**.

> ⚠️ **Anti-Spam Delivery Pacing**: To protect your WhatsApp number reputation, the system automatically applies safe delivery delays between outbound broadcast messages.

---

## 8. Automations & Visual WhatsApp Flow Builder

Build custom automated WhatsApp workflows with a visual node canvas:

1. Navigate to **Automations** $\rightarrow$ **"Create New Flow"**.
2. Select a **Trigger**:
   - *Inbound Message Contains Keyword* (e.g. `"pricing"`, `"demo"`, `"help"`)
   - *New WhatsApp Contact Created*
   - *Tag Added*
3. Add **Action Nodes**:
   - **Send WhatsApp Message**: Auto-send brochures, product catalogs, or pricing links.
   - **Update Contact**: Automatically apply tags (e.g. `Hot Lead`).
   - **Assign to Agent**: Direct conversation to the right sales rep.
   - **AI Response Node**: Let the trained AI answer complex questions.
4. Click **Publish** to make the flow live.

---

## 9. AI Knowledge Base & WhatsApp Auto-Replies (RAG)

Train your CRM AI to answer customer WhatsApp inquiries 24/7:

1. Navigate to **Agents / AI** $\rightarrow$ **Knowledge Base**.
2. Upload company documents, FAQ PDFs, pricing sheets, or type text guidelines.
3. The RAG engine indexes your knowledge using semantic vector search.
4. Enable **Auto-Reply**: When customers ask questions on WhatsApp, the AI generates accurate answers strictly grounded in your uploaded documents.

---

## 10. Team Management & Access Control

### 10.1 Role Permissions

| Capability | Super Admin | Admin | Agent / Member |
|---|:---:|:---:|:---:|
| Global Workspace Provisioning | ✅ | ❌ | ❌ |
| WhatsApp QR Connection | ✅ | ✅ | ❌ |
| Team Member Invitations | ✅ | ✅ | ❌ |
| View & Reply in WhatsApp Inbox | ✅ | ✅ | ✅ |
| Manage Deals & Contacts | ✅ | ✅ | ✅ |
| Create WhatsApp Broadcasts | ✅ | ✅ | ❌ |

### 10.2 Inviting Team Members
1. Go to **Settings** $\rightarrow$ **Team Members**.
2. Click **"Invite Member"**, enter their email address, and select their role (**Admin** or **Agent**).
3. Share the generated invitation link with your team member.

---

## 11. Troubleshooting & Frequently Asked Questions (FAQ)

### Q1: My WhatsApp shows "Disconnected". How do I reconnect?
- Go to **Channels** $\rightarrow$ **WhatsApp QR Gateway**.
- Click **"Reconnect"** or **"Generate QR Code"** and scan it again with your mobile phone under **WhatsApp $\rightarrow$ Linked Devices**.

### Q2: Why are some contacts not receiving WhatsApp broadcasts?
- Ensure the phone number includes the international country code (e.g., `+1` for USA, `+91` for India).
- Check if the recipient has blocked messages or if your WhatsApp session was temporarily offline during dispatch.

### Q3: How do I backup or export my WhatsApp contacts?
- Go to **Contacts** $\rightarrow$ click the **Export CSV** button in the top right to download all contacts, tags, and custom fields.

### Q4: Can two agents reply to the same customer at once?
- No. The CRM includes real-time **Collision Prevention**. If another agent is actively looking at or typing in a WhatsApp chat, a badge alerts you immediately.

---

*End of Operations Manual — CloudMasa WhatsApp CRM v0.8.0*

# CloudMaSa CRM (MaSa CRM) & Omnichannel Gateway

[![Next.js](https://img.shields.io/badge/Next.js-16_App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_15-green?style=flat-square&logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-Modern_UI-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Baileys](https://img.shields.io/badge/Baileys-WhatsApp_Multi_Device-25D366?style=flat-square&logo=whatsapp)](https://github.com/WhiskeySockets/Baileys)
[![Vitest](https://img.shields.io/badge/Tests-762_Passing-brightgreen?style=flat-square&logo=vitest)](https://vitest.dev/)

An enterprise-grade, multi-tenant Omnichannel Customer Relationship Management (CRM) and Marketing Automation platform designed for modern sales, customer support, and conversational commerce.

---

## 📖 Key Documentation

- 📘 **[Full Enterprise Architecture & Product Manual](PRODUCT_DOCUMENTATION.md)** — Complete in-depth guide covering multi-tenancy, encryption, smart contact cleanup, project-specific email gateways, and database schemas.
- 🚀 **[Production Deployment Guide](DEPLOYMENT.md)** — Step-by-step instructions for Nginx reverse proxy, SSL certificates, PM2, and Docker Compose.
- 🛠️ **[Public REST API Guide](docs/public-api.md)** — Full specification for external CRM integrations, webhooks, and programmatic messaging.
- 🤖 **[Automation Engine Setup](docs/automation-setup.md)** — Guide for visual node canvas automations and AI bots.

---

## ✨ Core Features

- 💬 **WhatsApp Web QR Gateway**: Real-time QR pairing via Baileys multi-device engine on port `8088`. Requires zero Meta Business verification.
- 🏢 **Meta WhatsApp Cloud API**: Official WhatsApp Business Platform with template sync, HSM messages, and interactive quick-reply buttons.
- 📥 **Unified Omnichannel Inbox**: Real-time incoming and outgoing conversations across WhatsApp, Instagram Direct, and Facebook Messenger.
- 📧 **Project-Specific Email Campaign Gateway**: Dedicated SMTP connection per project (Gmail App Passwords, Outlook/Office 365, Zoho Mail, Custom SMTP) with 1x1 open pixels and click tracking.
- 🧹 **Smart WhatsApp Contact Cleanup**: Automatically purges un-interacted address book syncs on disconnect or on-demand, while strictly preserving active customers, messaged contacts, deals, and assignments.
- 🛡️ **Designated Default Admin Protection**: Safeguards the primary administrator from accidental demotion or deletion while allowing dynamic role switching (Agent $\leftrightarrow$ Admin) for other team members.
- 🔀 **Visual Automation Flow Builder**: Node canvas with triggers, conditional logic, team routing, webhooks, and AI bot handoffs.
- 🧠 **AI Knowledge Base (RAG)**: Ingests documents and FAQs with semantic search using `pgvector` to provide grounded auto-replies.
- 📊 **Deals & Kanban Sales Pipeline**: Visual stages, multi-currency conversion metrics, and revenue tracking.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ or v24 LTS
- **Package Manager**: `npm`
- **Database**: PostgreSQL with Supabase credentials

### 2. Environment Setup
Copy the example environment file and fill in your Supabase credentials:
```bash
cp .env.example .env
```

Ensure the key variables are configured:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://twpuqntljgavimlocplg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ENCRYPTION_KEY=0818e6bd2f12b6e14376567ff2da1f16311f4a1c6e947b4221af1d523cd6f4a5
WHATSAPP_GATEWAY_URL=http://localhost:8088
```

### 3. Running Locally

#### Start the Application Server (Port 3000)
```bash
npm install
npm run dev
```

#### Start the WhatsApp Baileys Gateway (Port 8088)
In a separate terminal:
```bash
cd gateway
npm install
npm run dev
```

Visit **`http://localhost:3000`** in your browser.

---

## 🧪 Testing & Verification

```bash
# Validate TypeScript type safety (0 errors)
npm run typecheck

# Run automated test suites (762 tests passing)
npm run test:run

# Build production bundle
npm run build
```

---

## 🐳 Docker Deployment

The application is containerized with multi-stage builds and Docker Compose:

```bash
docker compose up -d --build
docker compose logs -f
```

---

## 📄 License & Maintainer

Maintained with ❤️ by the **CloudMaSa Engineering Team**.
Licensed under the [MIT License](LICENSE).
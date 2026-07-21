# 🛡️ ZENITSU LIVE v4.0 — Security & Whitelist User Manual

Welcome to the official **Zenitsu Live** Security & Whitelist Configuration Guide. Zenitsu Live operates on a **Zero-Trust Security Model**, ensuring that your Discord server is completely protected against unauthorized channel deletions, category modifications, log tampering, and nuke attempts.

---

## 🔑 Key Security Principles

1. **Zero-Trust Whitelist Enforcement**:
   - Native Discord permissions (such as `Administrator` or `Manage Channels`) **do NOT grant bypass access** to bot features or AI automations.
   - Users and roles must be explicitly granted capabilities inside the bot using `/whitelist` or `/whitelist-role`.

2. **Server Creator Exclusive Authority**:
   - The **Server Creator (Server Owner)** holds ultimate authority over the bot.
   - Message deletions and purging inside server log channels (`#server-logs`, `#mod-log`, `#security-logs`, `#everlog`, etc.) are **restricted exclusively to the Server Creator**, unless explicitly delegated via the `LOG_MANAGE` capability.

3. **Real-Time Anti-Nuke Active Defense**:
   - If an unauthorized user or staff member attempts to delete a channel, create a channel, modify roles, or delete log messages directly on Discord, Zenitsu's **Real-Time Audit Log Engine** instantly:
     - **Strips all roles** from the unauthorized user to lock down their access.
     - **Re-posts / restores deleted log messages**.
     - **Dispatches a Red Alert embed** to `#mod-log` / `#security-logs`.

---

## 📜 The 14 System Capabilities

Zenitsu Live features **14 granular capabilities** that can be assigned to individual users (`/whitelist`) or roles (`/whitelist-role`).

| Icon | Capability Key | Capability Name | Description & Commands Allowed |
| :--- | :--- | :--- | :--- |
| 🤖 | `AI_CONFIG` | **AI Configuration** | Allows configuring AI channels (`/ai-channel`) and default AI models (`/ai-model`). |
| 🛡️ | `SECURITY_CONFIG` | **Security & Anti-Raid** | Allows configuring Anti-Nuke, Anti-Spam, and Security settings (`/security`, `/setup-logs`). |
| ⚔️ | `MODERATION_EXECUTE` | **Moderation Execution** | Allows executing moderation punishments (`/warn`, `/kick`, `/mute`, `/timeout`, `/ban`, `/purge`, `/lock`, `/unlock`, `/slowmode`). |
| 🔑 | `ROLE_ASSIGN` | **Whitelisted Role Management** | Allows managing staff roles, user whitelists, and role capability assignments (`/role`, `/whitelist`, `/whitelist-role`). |
| 📣 | `EMBED_MANAGE` | **Custom Embeds & Say** | Allows sending bot announcements and custom embeds (`/say`, `/embed`, `/ai-embed`). |
| 🎫 | `TICKET_CONFIG` | **Ticket Panel Setup** | Allows creating and configuring interactive ticket support panels (`/setup-panel`). |
| ⚙️ | `SERVER_CONFIG` | **Server Setup & Config** | Allows running server templates and music setup (`/setup-server`, `/setup-music`). |
| 📁 | `EDIT_CATEGORY` | **Edit Categories & Channels** | Allows creating, renaming, and configuring channels or categories via `/dev-ai` and AI automations. |
| 🗑️ | `DELETE_CHANNEL` | **Delete Channels** | Allows deleting text or voice channels via `/dev-ai` and AI automations. |
| 🗑️ | `DELETE_CATEGORY` | **Delete Categories** | Allows deleting category folders and child channels via `/dev-ai` and AI automations. |
| 📜 | `LOG_MANAGE` | **Log Channel Management** | Allows purging or deleting messages inside server log channels (`#server-logs`, `#mod-log`, `#security-logs`). |
| 🧠 | `AI_EXECUTE` | **DEV-AI Prompt Execution** | Allows executing natural-language prompts via `/dev-ai`. *(Requires specific action capability for destructive tools)*. |
| ⚡ | `AI_ACTIONS` | **AI Tools Execution** | Allows AI channel tools and direct AI moderation executions. |
| ⚙️ | `AI_AUTOMATION` | **AI Background Automations** | Allows background server automations and modal followup approvals. |

---

## 🛠️ Step-by-Step Configuration Guides

### Guide 1: How to Whitelist a User & Assign Capabilities
1. Run the `/whitelist` slash command.
2. In the interactive panel, click the **➕ Select a user to whitelist** menu.
3. Select the member from the dropdown.
4. Use the **14 System Capabilities Dropdown** to select/deselect the exact capabilities you want to grant to that user.
5. Changes save automatically to the database with a unique Audit Tracking ID (e.g. `WL-20260721-A1B2C3`).

---

### Guide 2: How to Whitelist a Role & Assign Tiers
1. Run the `/whitelist-role` slash command.
2. Click the **➕ Select a role to whitelist** menu and choose a server role (e.g. `@Admin`, `@Senior Staff`).
3. In the Role Configuration Panel:
   - **Select Tier**: Choose `Admin Tier`, `Staff Tier`, or `Normal Member Tier`.
   - **Select Capabilities**: Select only the specific capabilities that role needs.
4. *Note*: By default, `DELETE_CHANNEL`, `DELETE_CATEGORY`, and `EDIT_CATEGORY` are **disabled** for all roles unless explicitly selected by the Server Creator.

---

### Guide 3: Log Channel Protection & `LOG_MANAGE` Delegation
- **Default Protection**: All log channels (`#server-logs`, `#mod-log`, `#security-logs`, `#everlog`, `#message-logs`, etc.) are locked.
- **Deleting/Purging Messages**: If any user or staff member (who is not the Server Creator and lacks `LOG_MANAGE`) deletes a message in a log channel or runs `/purge`:
  - Zenitsu **blocks the command** or **restores & re-posts the deleted message**.
  - Zenitsu **strips all staff/admin roles** from the offender.
- **How to Delegate Log Access**: If the Server Creator wants to allow a trusted Admin to manage logs, grant them the **`LOG_MANAGE`** capability in `/whitelist` or `/whitelist-role`.

---

## 🚨 Active Anti-Nuke Audit Log Defense

Zenitsu Live actively listens to Discord's Audit Log stream in real time. If a user tries to bypass the bot by right-clicking directly on Discord:

- **Unauthorized Channel Deletion** (Lacks `DELETE_CHANNEL` cap) → **Roles Stripped + Security Alert Embed**
- **Unauthorized Channel Creation / Rename** (Lacks `EDIT_CATEGORY` cap) → **Roles Stripped + Security Alert Embed**
- **Unauthorized Role Deletion / Creation** (Lacks `ROLE_ASSIGN` cap) → **Roles Stripped + Security Alert Embed**
- **Unauthorized Mass Kicks / Bans** (Lacks `MODERATION_EXECUTE` cap) → **Roles Stripped + Security Alert Embed**

---

## 📌 Complete Command Reference

| Command | Category | Required Capability / Permission | Description |
| :--- | :--- | :--- | :--- |
| `/whitelist` | Security | `ROLE_ASSIGN` / Owner | Open user whitelist management panel. |
| `/whitelist-role` | Security | `ROLE_ASSIGN` / Owner | Open role capability & tier management panel. |
| `/security` | Security | `SECURITY_CONFIG` | Configure Anti-Nuke thresholds, Anti-Raid, and log channels. |
| `/dev-ai` | AI / Admin | `AI_EXECUTE` + Action Cap | Execute natural language server commands. |
| `/ai-channel` | AI | `AI_CONFIG` | Set up or remove an AI interactive channel. |
| `/ai-model` | AI | `AI_CONFIG` | Change the default AI model (Gemini, Claude, GPT). |
| `/purge` | Moderation | `MODERATION_EXECUTE` | Bulk delete messages in non-log channels. |
| `/clear-channel` | Utility | `EMBED_MANAGE` / Owner | Re-create/clear non-log channels with identical settings. |
| `/say` | Utility | `EMBED_MANAGE` | Send custom bot text or embedded announcements. |
| `/setup-panel` | Support | `TICKET_CONFIG` | Deploy interactive support & ticket panels. |
| `/setup-server` | Setup | `SERVER_CONFIG` | Apply complete pre-built Discord server templates. |

---

*Zenitsu Live v4.0 Anti-Nuke Architecture — Built for Maximum Security & Full Administrative Control.*

# EduFlow System Architecture

## Overview

EduFlow is a multi-tenant school request management platform.

The system supports three user roles:

- Institution Manager

- Teacher

- Secretary

Each institution is isolated using Row Level Security (RLS).

---

# Architecture

Frontend:

- React

- TypeScript

- Vite

Backend:

- Supabase Auth

- PostgreSQL Database

- Supabase Edge Functions

Security:

- Row Level Security (RLS)

- SECURITY DEFINER helper functions

- Role-based authorization

- Institution isolation

---

# Main Modules

## Authentication

- Login

- Password setup

- Session management

## User Management

- Create users

- Role assignment

- Institution membership

## Requests

- Create request

- View requests

- Update request status

## Request Status History

- Automatic audit trail

- Status change tracking

## Notifications

- Automatic teacher notifications

- Read/unread state

## Analytics

- Manager dashboard

- Operational statistics

- Recent activity

---

# Database Principles

- Multi-tenant design

- UUID primary keys

- Immutable audit history

- Trigger-based automation

- Database-enforced permissions

---

# Current Architecture Diagram

Institution

↓

Users

↓

Requests

↓

Status History

↓

Notifications

↓

Analytics
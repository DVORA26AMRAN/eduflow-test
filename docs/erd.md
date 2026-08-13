# EduFlow Entity Relationship Diagram (ERD)

## Entities

### institutions

- id (PK)

- name

- institution_code (optional, unique when non-empty)

- address, city, phone, email (optional contact fields)

- logo_url, logo_updated_at (Platform Admin branding)

- created_at, updated_at

### users

- id (PK) — equals `auth.users.id`

- institution_id (FK -> institutions.id, **nullable**)

  - `platform_admin` → MUST be NULL (global)

  - `teacher` | `secretary` | `institution_manager` → MUST be NOT NULL

- email

- full_name

- primary_role (`public.user_role`: institution_manager | secretary | teacher | platform_admin)

- status

- onboarding_completed_at (NULL = awaiting join; timestamptz = completed)

- created_at

- Partial unique: at most one **active** `institution_manager` per `institution_id`

### requests

- id (PK)

- institution_id (FK -> [institutions.id](http://institutions.id))

- created_by_user_id (FK -> [users.id](http://users.id))

- request_type

- description

- status

- created_at

- updated_at

### request_status_history

- id (PK)

- request_id (FK -> [requests.id](http://requests.id))

- institution_id (FK -> [institutions.id](http://institutions.id))

- changed_by_user_id (FK -> [users.id](http://users.id))

- previous_status

- new_status

- created_at

### notifications

- id (PK)

- institution_id (FK -> [institutions.id](http://institutions.id))

- user_id (FK -> [users.id](http://users.id))

- notification_type

- title

- message

- is_read

- metadata

- created_at

---

## Relationships

Institution (1) -------- (*) Users

Institution (1) -------- (*) Requests

Institution (1) -------- (*) Notifications

User (1) -------- (*) Requests

(created_by_user_id)

User (1) -------- (*) Notifications

User (1) -------- (*) RequestStatusHistory

(changed_by_user_id)

Request (1) -------- (*) RequestStatusHistory
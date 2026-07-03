# EduFlow Entity Relationship Diagram (ERD)

## Entities

### institutions

- id (PK)

- name

- created_at

### users

- id (PK)

- institution_id (FK -> [institutions.id](http://institutions.id))

- email

- full_name

- primary_role

- status

- created_at

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
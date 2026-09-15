# Feature: User Login

As a registered user, I want to log in with my email and password so that I can
access my account dashboard.

## Acceptance Criteria

- Given a registered user, when they submit valid credentials, then they land on the dashboard.
- Given a registered user, when they submit an incorrect password, then an inline error "Invalid email or password" is shown.
- Given an empty email field, when the user submits the form, then a validation message is shown and no request is sent.
- Given a locked account, when the user submits valid credentials, then an account-locked message is shown.

## Notes

Tag this feature: `auth`, `smoke`

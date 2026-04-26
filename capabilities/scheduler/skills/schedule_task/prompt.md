# schedule_task

Use this skill when the user asks to schedule recurring automation.
Require a clear cron expression and concrete task description.
Prefer updates to existing job IDs when the user is modifying an existing schedule.
Make sure to use UTC time to create the cron job.(If user gives local time it is need to convert to UTC time)

import assert from 'node:assert/strict'
import test from 'node:test'
import { translateText } from './translations.js'

test('production management screens have Hindi translations for their primary controls', () => {
  const labels = [
    'Device status', 'Revoke & sign out', 'Notifications & alerts', 'Mark all read',
    'Students', 'Add student', 'User accounts', 'Invite user', 'Link children', 'Generate PDF',
    'Mark all present', 'Find a student by name or ID', 'Sync conflict · review server changes before editing', 'Assign a teacher', 'Starts on', 'Save end date', 'Deactivate', 'Reactivate', 'Load current server register', 'Camera permission was denied. Allow camera access in your browser settings, then try again.', 'Confirm submission', 'Student ID',
    'HELP & GUIDANCE', 'Using RuralAttend', 'Choose a role', 'Take attendance', 'Review reports', 'Understand demo limits', 'Page not found', 'Back to dashboard',
    'EDUCATION DEPARTMENT · AUTHORIZED SCOPE', 'Consolidated CSV', 'Attendance date', 'All authorized districts', 'SCHOOLS IN SCOPE', 'VERIFICATION', 'Showing {start}–{end} of {total}', 'Schools in authorized scope', 'AUTHORIZED SCHOOL DETAIL',
    'FAMILY PORTAL', 'FAMILY PORTAL · LINKED CHILDREN ONLY', 'Choose a linked child', 'Recorded school days', 'No attendance history has been recorded for this child on this device.', 'Not recorded', 'Daily status recorded by the class teacher.', 'No record', 'No school', 'Only linked children appear here. Sample attendance defaults are illustrative; records are stored on this device.',
    'Today', 'Recorded attendance', 'Absence notifications',
    'INBOX · DEMO NOTIFICATIONS', 'Illustrative updates for this evaluation account.', 'Attendance submitted', 'Class V - A register was submitted for today.', 'Today · 9:18 am', 'Low attendance follow-up', 'A learner has attendance below the 75% review threshold.', 'Yesterday · 3:40 pm', 'School calendar updated', 'The October school calendar is available for families.', '12 Oct · 11:05 am', 'Approved', 'Sample roles and access levels for this school.', 'LAST ACTIVE', 'Yesterday', 'ACCESS MANAGEMENT · DEMO', 'Account management is illustrative only. This frontend demo has no authentication server or real user provisioning.', 'DEVICE & SYNC MONITOR', 'Local storage and connectivity for this browser.', 'Attendance drafts are stored in local browser storage.', 'CONNECTED', 'Pending sync queue', 'No remote service is configured in this demo build.', 'LOCAL EVENTS', 'Service status', 'PWA installation and server sync are not configured.', 'DEMO MODE', 'ADMINISTRATION · AUDIT TRAIL', 'Attendance submissions and corrections made in this demo.', 'No events recorded yet.',
    'Years with classes or attendance history are retained.', 'SCHOOL CALENDAR', 'Refresh academic years', 'Loading academic years…', 'Current', 'Set current', 'No academic years have been created.', 'UPDATE YEAR', 'ADD YEAR', 'Edit academic year', 'Cancel edit', 'Starts', 'Ends', 'Make this the current year', 'Save changes', 'Create year',
    'ADMINISTRATION · AUTHORIZED AUDIT', 'AUTHORIZED REPORT · SERVER DATA', 'Attendance report', 'Current learner directory:', 'EVENTS', 'Enter a class name.', 'Enter a staff name and teaching assignment.', 'Enter a student name and select a class.', 'Events are stored locally and can be cleared from browser storage.', 'Guardian name', 'Invitations require the authenticated server workspace; demo accounts are illustrative only.', 'Loading camera scanner…', 'Loading…', 'No attendance submissions yet. Submitted registers and corrections will appear here.', 'Present on end date', 'QUICK ACTIONS', 'RECENT ACTIVITY', 'REVIEW & AUDIT', 'Register changes', 'Section', 'Submitted registers and corrections recorded on this device.', 'Teacher name', 'View all', '{count} schools',
    'RURAL SCHOOL ATTENDANCE', 'Reset your password', 'Access unavailable', 'Choose a new password', 'We will send a short-lived reset link if the account exists.', 'Enter your password', 'Sign in securely', 'Send recovery instructions', 'One-time reset token', 'At least 12 characters', 'Set new password', 'Return to sign in', 'Secure account access', 'Every learner is accounted for.',
    'PORTAL · DEMO DATA', 'Schools monitored', 'Across 6 demo districts', 'Server-authorized assignments', 'Attendance today', 'Pending submissions', 'Offline records', 'TODAY AT A GLANCE', 'Pick up where you left off', 'Open today’s register', 'Check or correct entries', 'Weekly attendance trend',
    'PORTAL · AUTHORIZED DATA', 'No attendance trend data is available yet.', 'Report data is not available yet. Try again after the server report loads.', 'Authorized records · last 30 days',
  ]
  for (const label of labels) {
    assert.notEqual(translateText(label, 'Hindi'), label, `${label} should be translated`)
  }
})

test('dynamic names and unknown text safely fall back to the source value', () => {
  assert.equal(translateText('Aarav Sharma', 'Hindi'), 'Aarav Sharma')
  assert.equal(translateText('An untranslated server error', 'Hindi'), 'An untranslated server error')
})

test('English preference returns source strings unchanged', () => {
  assert.equal(translateText('Device status', 'English'), 'Device status')
})

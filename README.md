# finance MEDTECH ของนักศึกษาเทคนิคการแพทย์ รุ่น 4 รหัส 67 มหาวิทยาลันปทุมธานี

### SlipOK backup branch
Set server-side Supabase Edge Function secrets `SLIPOK_API_KEY_2` and `SLIPOK_BRANCH_ID_2` to enable the second branch. Keep primary credentials under their existing names. Configure the same receiving account in both branches. The service checks primary quota before sending when a complete backup is configured; zero quota or error 1004 switches to branch 2. Invalid, duplicate, wrong-recipient and wrong-amount slips never trigger branch fallback. Missing backup configuration retains primary-only behavior. Both exhausted branches leave the payment for review. No credentials belong in frontend config or GitHub.

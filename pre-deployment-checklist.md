# Pre-Deployment Checklist

Things to do before giving judges access.

---

## Access Control
- [ ] Set real access code in `.env` (`ACCESS_CODE=cookwithmia26` or similar)
- [ ] Implement code validation in `verify-code` endpoint (check against env var with `hmac.compare_digest`)
- [ ] Test: wrong code shows error, correct code lets you in

## Cloud Deployment
- [ ] Deploy backend to Cloud Run
- [ ] Update frontend to connect to Cloud Run URL (or use same-origin proxy)
- [ ] Verify WebSocket works over `wss://` (not just `ws://`)
- [ ] Set environment variables in Cloud Run (GOOGLE_CLOUD_PROJECT, etc.)
- [ ] Test full flow on deployed version

## Testing
- [ ] Run through full `testing-checklist.md` on deployed version
- [ ] Test on mobile (Chrome Android)
- [ ] Test on Safari iOS (if possible)
- [ ] Test with headphones vs loudspeaker
- [ ] Test with camera in video mode
- [ ] Test 5+ minute session for stability

## Submission Requirements
- [ ] Record 4-minute demo video showing actual software working
- [ ] Create architecture diagram (Gemini Live API + backend + frontend)
- [ ] Write Devpost submission description (features, tech stack, learnings)
- [ ] Include spin-up instructions in README.md
- [ ] Record proof of Google Cloud deployment (screen recording or code link)
- [ ] Make code repository public
- [ ] Include link to demo video (YouTube or Vimeo, public)

## Bonus Points
- [ ] Publish blog post or content piece (+0.6 points max)
  - Must be public, mention hackathon, use #GeminiLiveAgentChallenge
- [ ] Automate deployment with scripts or IaC (+0.2 points)
  - Include in public repo
- [ ] GDG membership profile link (+0.2 points)

## Final Checks
- [ ] Verify Google Cloud billing/credits (stay under $100)
- [ ] Remove any debug logging or test data
- [ ] Test access code flow end-to-end
- [ ] Verify submission deadline (March 16, 2026, 5:00 PM PT)

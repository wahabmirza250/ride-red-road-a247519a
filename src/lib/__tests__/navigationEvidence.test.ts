import {it,expect} from 'vitest';
import {looksLikePossiblySubmittedTimeout,looksLikePostConfirmTimeout,hasExplicitPreSubmitFailureEvidence} from '../submitEvidence';
import {isPortalNavigationFailure} from '../portalNavigation';
it('does not turn opening a claim form into evidence of submission',()=>{
 const message="locator.click: Timeout 8000ms exceeded. waiting for locator('text=Submit Claim Prof').last() element is not visible";
 expect(looksLikePossiblySubmittedTimeout(message)).toBe(false);
 expect(looksLikePostConfirmTimeout(message)).toBe(false);
});
it('recognizes the worker pre-submit navigation marker',()=>{
 const message='PORTAL_NAVIGATION_FAILED: stage=navigate submit_reached=false. Could not open the professional claim form.';
 expect(isPortalNavigationFailure(message)).toBe(true);
 expect(hasExplicitPreSubmitFailureEvidence(message)).toBe(true);
});
it('still protects actual Confirm and final-step timeouts',()=>{
 expect(looksLikePossiblySubmittedTimeout('ConfirmCmnButton Timeout 8000ms exceeded')).toBe(true);
 expect(looksLikePossiblySubmittedTimeout('SubmitClaimProf3 Timeout 8000ms exceeded')).toBe(true);
});

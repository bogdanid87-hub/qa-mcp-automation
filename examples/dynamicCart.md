Dynamic Cart Shipping & Tax Estimator
Goal: Increase checkout completion by providing transparent, up-front pricing before the user formally enters the multi-step checkout process.
1. Context & Objective
The Problem: Unexpected shipping costs and taxes are the leading causes of last-minute checkout drop-offs.
Success Metrics:
    Reduce drop-off on the first checkout page (Shipping & Billing step) by 15%.
    Increase usage of the in-cart estimator to at least 40% of cart sessions.
2. User Story
As a price-conscious buyer, I want to preview shipping costs and taxes in the cart based on my location, so that I am not surprised by the final total.
3. Functional Requirements
IP Geo-Location: Automatically detect the user’s location (via IP) and pre-populate the estimated shipping cost.
Zip/Postal Code Entry: Allow users to manually type in a different postal code if the IP location is inaccurate or they are buying a gift.
Carrier Selection: Provide a dropdown allowing users to toggle between different shipping speeds (e.g., Standard vs. Next Day) with the total instantly recalculating.
Error Handling: Display a fallback message if the address is invalid or if shipping is unavailable for the selected region.
4. Out of Scope for MVPInternational multi-currency conversion (limited to UK addresses for Phase 1).
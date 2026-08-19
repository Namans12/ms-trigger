"""Buy/rent-only availability: a distinct category, never disguised as a subscription.

Toy Story 5 has a real India digital release date but is buy/rent only — no
subscription tier lists it. Before this, that meant `providers == ()`, which
rendered as "Platform TBA" even though the title genuinely is available, just
not by subscription. It must now surface as its own tagged category rather than
either vanishing or being reported as a subscription platform it isn't on.
"""

from __future__ import annotations

import releasebot as rb


def watch_providers(*, flatrate=(), rent=(), buy=(), networks=()):
    buckets = {}
    if flatrate:
        buckets["flatrate"] = [{"provider_name": p} for p in flatrate]
    if rent:
        buckets["rent"] = [{"provider_name": p} for p in rent]
    if buy:
        buckets["buy"] = [{"provider_name": p} for p in buy]
    return {
        "watch/providers": {"results": {"IN": buckets}},
        "networks": [{"name": n} for n in networks],
    }


def test_rent_buy_providers_are_tagged_distinctly():
    details = watch_providers(buy=("Amazon Prime", "Apple TV+"))
    assert rb.rent_buy_providers(details, "IN") == ("Amazon Prime (Buy/Rent)", "Apple TV+ (Buy/Rent)")


def test_rent_and_buy_buckets_are_both_read():
    details = watch_providers(rent=("Google Play",), buy=("Apple TV+",))
    got = set(rb.rent_buy_providers(details, "IN"))
    assert got == {"Google Play (Buy/Rent)", "Apple TV+ (Buy/Rent)"}


def test_no_rent_buy_data_yields_empty():
    assert rb.rent_buy_providers(watch_providers(), "IN") == ()


def test_rent_buy_names_are_still_canonicalized():
    """Alias collapsing (Prime Video -> Amazon Prime) must survive the tag."""
    details = watch_providers(buy=("Prime Video",))
    assert rb.rent_buy_providers(details, "IN") == ("Amazon Prime (Buy/Rent)",)


def test_providers_from_details_prefers_subscription_over_buy_rent():
    """A title with BOTH a subscription tier and a rent/buy tier is on the
    service — the rent/buy tag would misleadingly downgrade it."""
    details = watch_providers(flatrate=("Netflix",), buy=("Apple TV+",))
    assert rb._providers_from_details(details, "IN", None) == ("Netflix",)


def test_providers_from_details_falls_back_to_buy_rent_before_network_guess():
    """Real TMDB rent/buy data beats the network-name heuristic."""
    details = watch_providers(buy=("Amazon Prime",), networks=("ZEE5",))
    assert rb._providers_from_details(details, "IN", None) == ("Amazon Prime (Buy/Rent)",)


def test_providers_from_details_with_nothing_at_all_stays_empty():
    """A Beautiful Obsession: no subscription, no rent/buy, no known network."""
    details = watch_providers(networks=("Some Broadcast Channel",))
    assert rb._providers_from_details(details, "IN", None) == ()


def test_buy_rent_only_movie_forms_its_own_message_category():
    """The digest groups by exact provider string — the tag makes this a
    category distinct from a real "Amazon Prime" subscription section."""
    item = rb.ReleaseItem(
        tmdb_id=1, title="Toy Story 5", media_type="movie", language="en",
        release_date="2026-08-18", rating=7.0, popularity=50.0, overview="",
        tmdb_url="https://example.invalid", poster_url="/p.jpg",
        providers=("Amazon Prime (Buy/Rent)",),
    )
    grouped = rb.group_by_provider([item])
    assert "Amazon Prime (Buy/Rent)" in grouped
    assert "Platform TBA" not in grouped, "a known buy/rent title is not an unknown platform"


def test_still_falls_through_to_platform_tba_when_truly_unknown():
    item = rb.ReleaseItem(
        tmdb_id=2, title="A Beautiful Obsession", media_type="tv", language="en",
        release_date="2026-08-19", rating=None, popularity=1.0, overview="",
        tmdb_url="https://example.invalid", poster_url=None, providers=(),
    )
    assert "Platform TBA" in rb.group_by_provider([item])

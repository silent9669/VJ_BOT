async def test_get_profile_404_before_onboarding(client):
    response = await client.get("/api/profile", params={"user_id": "u1"})

    assert response.status_code == 404


async def test_post_profile_derives_track(client):
    first = await client.post("/api/profile", json={"user_id": "u1", "level": "N4"})

    assert first.status_code == 200
    assert first.json()["track"] == "minna"

    second = await client.post("/api/profile", json={"user_id": "u1", "level": "N2"})

    assert second.status_code == 200
    assert second.json()["track"] == "advanced"


def test_beginner_effective_level_is_n5():
    from app.services.profiles import effective_level

    assert effective_level("beginner") == "N5"


async def test_invalid_level_is_422(client):
    response = await client.post("/api/profile", json={"user_id": "u1", "level": "N9"})

    assert response.status_code == 422

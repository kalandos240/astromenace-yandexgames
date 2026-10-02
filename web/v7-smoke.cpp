#if defined(__EMSCRIPTEN__) && defined(ASTROMENACE_WEB_SMOKE_TEST)
#include <emscripten.h>
#include "src/core/core.h"
#include "src/game.h"
#include "src/config/config.h"
#include "src/ui/game_speed.h"
#include "src/assets/texture.h"
#include "src/object3d/space_ship/space_ship.h"
#include "src/object3d/explosion/explosion.h"
#include <cstdlib>
using namespace viewizard;
using namespace viewizard::astromenace;
extern "C" EMSCRIPTEN_KEEPALIVE void AstroMenaceWebStressSpawn()
{
    std::srand(731);
    cGameSpeed::GetInstance().SetThreadSpeed(0.0f);
    if (auto Player = PlayerFighter.lock()) Player->ArmorCurrentStatus = 10000000.0f;
    for (int i = 0; i < 24; ++i) {
        auto Weak = CreateAlienSpaceFighter(1);
        if (auto Ship = Weak.lock()) {
            Ship->SetLocation(sVECTOR3D{(i % 8 - 3.5f) * 12.0f, 0.0f, 20.0f + (i / 8) * 20.0f});
            Ship->ArmorCurrentStatus = 1000000.0f;
        }
    }
    for (int i = 0; i < 8; ++i) {
        auto Weak = CreateAlienSpaceFighter(1);
        if (auto Ship = Weak.lock()) {
            Ship->SetLocation(sVECTOR3D{(i - 3.5f) * 8.0f, 0.0f, 10.0f});
            CreateSpaceExplosion(*Ship, 2, Ship->Location, 0.0f, -1);
        }
        ReleaseSpaceShip(Weak);
    }
    const auto Texture = GetPreloadedTextureAsset(hash_djb2a("gfx/flare1.tga"));
    for (int i = 0; i < 120; ++i) {
        auto Weak = vw_CreateParticleSystem();
        if (auto System = Weak.lock()) {
            System->SetStartLocation(sVECTOR3D{(i % 12 - 5.5f) * 5.0f, 0.0f, 5.0f + (i / 12) * 6.0f});
            System->Texture = Texture;
            System->SizeStart = System->SizeEnd = 0.2f;
            System->Life = 8.0f;
            System->Speed = 0.0f;
            System->IsSuppressed = true;
            System->SmokeEmitParticles(64);
        }
    }
}
extern "C" EMSCRIPTEN_KEEPALIVE void AstroMenaceWebStressAnimate()
{
    cGameSpeed::GetInstance().SetThreadSpeed(GameConfig().GameSpeed);
}
#endif

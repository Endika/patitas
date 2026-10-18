# Changelog

## [0.3.0](https://github.com/Endika/patitas/compare/v0.2.0...v0.3.0) (2026-10-18)


### Features

* preview the chosen puppy on the adoption screen ([f7c4c27](https://github.com/Endika/patitas/commit/f7c4c2702432b9bd84aef89b14577d78b013a14f))


### Bug Fixes

* frame the preview puppy and keep adopt in view ([15fc3e7](https://github.com/Endika/patitas/commit/15fc3e744e435bdab5083bd7617eaacf27d58b68))
* keep a failed puppy's notice while another one loads ([16f43ba](https://github.com/Endika/patitas/commit/16f43ba83c9f636a40cad1b6c87f38f37545bdb1))
* keep adopt in view with the unsaved notice on small phones ([c6edcb5](https://github.com/Endika/patitas/commit/c6edcb59c11fbf50e8fcdc8d926384b8555831ec))
* tell the player when a puppy cannot be prepared ([163b70d](https://github.com/Endika/patitas/commit/163b70d959ebf27fb287e94340cb331b673412da))


### Performance Improvements

* build puppy meshes in a web worker ([763be0c](https://github.com/Endika/patitas/commit/763be0cd65a82ada89f81fa2e19f1d5dcd1c0162))
* frame the preview puppy without skinning every shell ([9a51e0b](https://github.com/Endika/patitas/commit/9a51e0b1a136080c5c860d3eb8051fc034fee11a))

## [0.2.0](https://github.com/Endika/patitas/compare/v0.1.0...v0.2.0) (2026-10-18)


### Features

* add a debug page that shows one puppy in the room ([572dbde](https://github.com/Endika/patitas/commit/572dbde44d44ac61d669e01bead7dc7b301ede9d))
* add adoption and room screens ([3a21443](https://github.com/Endika/patitas/commit/3a21443e1dc44375c142d78d6554a21b837a4ca7))
* add an fps meter for measuring on the phone ([9ede4dd](https://github.com/Endika/patitas/commit/9ede4ddd478ae1223a4b470006e8a85d94e485f7))
* add breeds, puppy and room domain ([211b63c](https://github.com/Endika/patitas/commit/211b63c7cc7148457836b22c727d0b4b78db614b))
* add puppy paw icon and generated pwa icons ([f9d54ca](https://github.com/Endika/patitas/commit/f9d54cad3813343db3bef0967dafacca348c817e))
* add the fixed camera play area, ball physics and fetch ([f4aad86](https://github.com/Endika/patitas/commit/f4aad86b63f2623f9b77e8cfb238c3b17a4c9a96))
* let two puppies share the room and the ball ([fe820b6](https://github.com/Endika/patitas/commit/fe820b6be6a4f44c971cd13244b93a3d0a94f469))
* port leg ik, gaits and poses as pure motion functions ([5075aad](https://github.com/Endika/patitas/commit/5075aad7529055fa9908868c96d63fc57cdd4fa1))
* port the procedural puppy geometry from the prototype ([bf07979](https://github.com/Endika/patitas/commit/bf07979a89beb0aa4c3b86d70613058709484084))
* render puppies and the room with the prototype's behaviour ([85e4bc6](https://github.com/Endika/patitas/commit/85e4bc666f260cbbfbc3ae77cd5d269d577fa9a3))
* store puppies and room in indexeddb with an in-memory fallback ([bb74214](https://github.com/Endika/patitas/commit/bb742147ebc18de0b2e34af5b330f82700d8f87e))


### Bug Fixes

* accept only own breed keys on the debug page ([6e02b00](https://github.com/Endika/patitas/commit/6e02b0058a1d98db31071f975bf198ad59801a8f))
* drop __dirname from vite configs and set manifest lang ([659dd8b](https://github.com/Endika/patitas/commit/659dd8bfdf01f2dcb6bd0a78528866ac1fe72b40))
* keep separated puppies inside the play area ([c4cc77b](https://github.com/Endika/patitas/commit/c4cc77b71b9f733279e350d77d47626c9aa1002b))
* polish room controls for phones ([1ab51d5](https://github.com/Endika/patitas/commit/1ab51d5a2ccd1a8d1f3366938f0eb9de04dfdbcc))
* release webgl resources when the room unmounts ([c6c7a7e](https://github.com/Endika/patitas/commit/c6c7a7eb65c05a4f8e6b6c8429be1b3eae43a3f1))
* tell the player when a new puppy waits outside a full room ([7c8622b](https://github.com/Endika/patitas/commit/7c8622ba45a61a93aa433d3d0557b6f20e3e5943))

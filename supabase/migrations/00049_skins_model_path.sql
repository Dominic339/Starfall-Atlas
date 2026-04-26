-- Add 3D model path reference to skins.
-- model_path is a public-directory-relative path to a .glb file,
-- e.g. "/assets/planets/Basic Station.glb".
-- NULL means the skin has no 3D preview assigned yet.

ALTER TABLE skins
  ADD COLUMN IF NOT EXISTS model_path TEXT;

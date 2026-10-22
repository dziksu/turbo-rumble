import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { disposeResources } from '../client/resources.ts';

test('removing a car releases its own GPU resources without destroying shared models', () => {
  const geometry = new T.BoxGeometry(),
    texture = new T.Texture(),
    material = new T.MeshBasicMaterial({ map: texture });
  const model = new T.Group();
  model.add(new T.Mesh(geometry, material));
  const car = model.clone(),
    labelTexture = new T.Texture(),
    labelMaterial = new T.SpriteMaterial({ map: labelTexture });
  car.add(new T.Sprite(labelMaterial));
  let geometryDisposals = 0,
    textureDisposals = 0,
    labelDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  labelTexture.addEventListener('dispose', () => labelDisposals++);
  disposeResources([car], [model]);
  assert.equal(geometryDisposals, 0);
  assert.equal(textureDisposals, 0);
  assert.equal(labelDisposals, 1);
  disposeResources([model, model.clone()]);
  assert.equal(geometryDisposals, 1);
  assert.equal(textureDisposals, 1);
});

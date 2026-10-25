import json

import pytest


def summary(client):
    challenge = client.post('/api/challenges', json={'creativeId': 'bmw-m3-v1'}).json()
    return {'challengeId': challenge['challengeId'], 'revision': 1, 'metrics': {
        'firstInteractionMs': 200, 'solveMs': None, 'missCount': 1,
        'path': [{'x': 0.2, 'y': 0.3, 't': 200, 'drag': 1}],
    }}


def test_pending_summary_retry_conflict_and_out_of_order(client):
    body = summary(client)
    assert client.post('/api/interaction-summaries', json=body).status_code == 201
    assert client.post('/api/interaction-summaries', json=body).json() == {'accepted': True, 'duplicate': True}
    changed = {**body, 'metrics': {**body['metrics'], 'solveMs': 700}}
    assert client.post('/api/interaction-summaries', json=changed).status_code == 409
    assert client.post('/api/interaction-summaries', json={**changed, 'revision': 2}).status_code == 201
    assert client.post('/api/interaction-summaries', json=body).status_code == 200
    stored = client.app.state.store.interactions[body['challengeId']]
    assert stored.revision == 2
    assert stored.metrics['solveMs'] == 700
    assert client.post('/api/interaction-summaries', json={**body, 'challengeId': 'missing'}).status_code == 404


@pytest.mark.parametrize('field,value', [('firstInteractionMs', -1), ('solveMs', 86400001),
    ('missCount', 1001), ('missCount', True), ('solveMs', 2.5), ('path', [{}] * 101)])
def test_invalid_metrics(client, field, value):
    body = summary(client)
    body['metrics'][field] = value
    assert client.post('/api/interaction-summaries', json=body).status_code == 422


@pytest.mark.parametrize('field,value', [('x', float('nan')), ('y', float('inf')), ('x', 1.01),
    ('drag', 0), ('drag', 1001), ('t', -1), ('t', True)])
def test_invalid_path(client, field, value):
    body = summary(client)
    body['metrics']['path'][0][field] = value
    assert client.post('/api/interaction-summaries', content=json.dumps(body),
        headers={'Content-Type': 'application/json'}).status_code == 422


def test_path_must_be_time_ordered(client):
    body = summary(client)
    body['metrics']['path'].append({'x': 0.5, 'y': 0.5, 't': 100, 'drag': 1})
    assert client.post('/api/interaction-summaries', json=body).status_code == 422


def test_body_limit_and_invalid_json(client):
    assert client.post('/api/interaction-summaries', content=b' ' * 16385).status_code == 413
    assert client.post('/api/interaction-summaries', content=b'{').status_code == 422


@pytest.mark.parametrize('path', [None, []])
def test_unmeasured_values_remain_distinct(client, path):
    body = summary(client)
    body['metrics'] = {'firstInteractionMs': None, 'solveMs': None, 'missCount': 0, 'path': path}
    assert client.post('/api/interaction-summaries', json=body).status_code == 201

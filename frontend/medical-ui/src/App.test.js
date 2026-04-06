import { act, render, screen } from '@testing-library/react';

jest.mock('./MedicalMesh', () => () => null);
jest.mock('./components/HospitalMap', () => () => null);

import App from './App';

test('renders DISHA landing and auth entry', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });

  render(<App />);
  act(() => {
    jest.advanceTimersByTime(2000);
  });

  expect(await screen.findByRole('button', { name: /continue to login/i })).toBeInTheDocument();

  fetchSpy.mockRestore();
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

import sys
import signal
import os
import subprocess

# --- THE ABSOLUTE WINDOWS FIX ---
# We must manually add SIGQUIT to the signal module so flwr doesn't crash on import
if sys.platform == "win32":
    if not hasattr(signal, 'SIGQUIT'):
        # We assign it to an existing Windows signal (SIGBREAK)
        setattr(signal, 'SIGQUIT', signal.SIGBREAK)

# Try importing Flower. If current interpreter cannot provide it,
# transparently re-exec this script with a known-good interpreter.
try:
    import flwr as fl
except ModuleNotFoundError:
    fallback_candidates = [
        os.getenv("DISHA_PYTHON", "").strip(),
        r"C:\Users\Arjaa Chatterjee\.conda\envs\myenv\python.exe",
        r"C:\ProgramData\miniconda3\python.exe",
    ]
    current = os.path.abspath(sys.executable)

    for candidate in fallback_candidates:
        if not candidate:
            continue
        candidate_abs = os.path.abspath(candidate)
        if candidate_abs == current:
            continue
        if os.path.exists(candidate_abs):
            print(f"[FED_SERVER] flwr missing in {current}")
            print(f"[FED_SERVER] Relaunching with {candidate_abs}")
            script_path = os.path.abspath(__file__)
            relaunch_args = [candidate_abs, script_path, *sys.argv[1:]]

            if sys.platform == "win32":
                # subprocess preserves spaced paths on Windows better than os.execv.
                completed = subprocess.run(relaunch_args, shell=False, check=False)
                raise SystemExit(completed.returncode)

            os.execv(candidate_abs, relaunch_args)

    raise ModuleNotFoundError(
        "No module named 'flwr'. Install with: \n"
        f"  \"{sys.executable}\" -m pip install flwr\n"
        "or run with:\n"
        "  C:/Users/Arjaa Chatterjee/.conda/envs/myenv/python.exe federated_server.py"
    )
from typing import List, Tuple
from flwr.common import Metrics

def weighted_average(metrics: List[Tuple[int, Metrics]]) -> Metrics:
    accuracies = [num_examples * m["accuracy"] for num_examples, m in metrics]
    examples = [num_examples for num_examples, _ in metrics]
    if sum(examples) == 0: return {"accuracy": 0}
    return {"accuracy": sum(accuracies) / sum(examples)}

def main():
    print("\n--- 🏥 FEDERATED SERVER: STARTING ---")
    strategy = fl.server.strategy.FedAvg(
        min_available_clients=1,
        evaluate_metrics_aggregation_fn=weighted_average,
    )

    # Use a while loop so it stays open
    while True:
        try:
            fl.server.start_server(
                server_address="0.0.0.0:8080",
                config=fl.server.ServerConfig(num_rounds=1000), 
                strategy=strategy,
            )
        except KeyboardInterrupt:
            print("\n🛑 Stopped by user.")
            break
        except Exception as e:
            print(f"Error: {e}. Restarting...")

if __name__ == "__main__":
    main()
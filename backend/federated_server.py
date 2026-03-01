import sys
import signal

# --- THE ABSOLUTE WINDOWS FIX ---
# We must manually add SIGQUIT to the signal module so flwr doesn't crash on import
if sys.platform == "win32":
    if not hasattr(signal, 'SIGQUIT'):
        # We assign it to an existing Windows signal (SIGBREAK)
        setattr(signal, 'SIGQUIT', signal.SIGBREAK)

# NOW we can safely import flwr
import flwr as fl
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
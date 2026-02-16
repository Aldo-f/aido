#!/usr/bin/env python3
"""
AIDO Test Script - Test OpenCode with AIDO proxy
Run multiple queries and track results

Usage:
    python aido_opencode_test.py         # Run all 50 queries
    python aido_opencode_test.py quick   # Run 10 quick queries
    python aido_opencode_test.py test    # Run 3 test queries
"""

import subprocess
import json
import time
import sys
import os
import re
from datetime import datetime

QUICK_QUERIES = [
    "What is 2+2?",
    "Write hello world in Python",
    "Explain the difference between AI and machine learning",
    "What is Python?",
    "Build a simple calculator",
    "How do I sort a list in Python?",
    "Tell me a joke",
    "Create a REST API endpoint",
    "What is Git?",
    "Write a function to reverse a string",
]

TEST_QUERIES = [
    # Simple queries
    "What is 2+2?",
    "Say hello",
    "How are you?",
    "What day is it?",
    # Coding queries
    "Write hello world in Python",
    "Create a function to reverse a string",
    "Write a function to check if a number is prime",
    "How do I sort a list in Python?",
    "Explain what a dictionary is in Python",
    "Write a Python class for a car",
    "How do I read a file in Python?",
    "Write a for loop in Python",
    "What is a list comprehension?",
    "Explain Python decorators",
    "Write a function to find the factorial",
    # Build/Create queries
    "Build a simple calculator",
    "Create a REST API endpoint",
    "Write a login form in HTML",
    "Create a database schema for users",
    "Build a simple web server",
    # Reasoning/Analysis
    "Explain the difference between AI and machine learning",
    "Compare Python and JavaScript",
    "What is the difference between SQL and NoSQL?",
    "Explain how HTTP works",
    "What is Docker?",
    # General questions
    "What is the weather?",
    "Tell me a joke",
    "What is Python?",
    "How does the internet work?",
    "What is open source?",
    # Debug/Fix
    "Fix this code: print('hello",
    "Why is my loop infinite?",
    "Debug: variable is undefined",
    # Long/complex queries
    "I have a Python script that reads a CSV file and processes the data but it's running very slow, how can I optimize it?",
    "Can you help me understand what this piece of code does? def foo(x): return x * 2",
    "I'm building a website and need to add user authentication, what is the best approach?",
    "Explain the concept of recursion with examples",
    "What are the best practices for API design?",
    # More coding
    "Write a binary search algorithm",
    "How do I use regular expressions in Python?",
    "What is the difference between == and is in Python?",
    "Explain Python's garbage collection",
    "Write a decorator function",
    # More general
    "What is Git?",
    "Explain version control",
    "What is a virtual environment?",
    "How do I install Python packages?",
    "What is pip?",
]

LOG_FILE = os.path.expanduser("~/.aido-data/logs/proxy.log")


def get_model_from_logs(since_time):
    """Get model used from proxy logs since given time"""
    if not os.path.exists(LOG_FILE):
        return "unknown"

    try:
        with open(LOG_FILE) as f:
            lines = f.readlines()

        for line in reversed(lines):
            if since_time in line and "Selected model:" in line:
                match = re.search(r"Selected model: (\S+)", line)
                if match:
                    return match.group(1)
    except:
        pass
    return "unknown"


def run_query(query, timeout=60):
    """Run a single query through opencode"""
    start_time = time.time()
    timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    try:
        result = subprocess.run(
            ["opencode", "run", query, "--model", "aido/auto"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        elapsed = time.time() - start_time

        # Get model from logs
        model = get_model_from_logs(timestamp[:19])

        # Parse output - get last line as response
        output_lines = result.stdout.strip().split("\n")
        response = output_lines[-1] if output_lines else ""

        return {
            "query": query,
            "response": response[:100],
            "model": model,
            "elapsed": elapsed,
            "success": True,
            "error": None,
        }

    except subprocess.TimeoutExpired:
        return {
            "query": query,
            "response": "",
            "model": "timeout",
            "elapsed": timeout,
            "success": False,
            "error": "Timeout",
        }
    except Exception as e:
        return {
            "query": query,
            "response": "",
            "model": "error",
            "elapsed": time.time() - start_time,
            "success": False,
            "error": str(e),
        }


def main():
    # Determine which queries to run
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    if mode == "quick":
        queries = QUICK_QUERIES
        print(f"AIDO Test Suite - QUICK mode ({len(queries)} queries)")
    elif mode == "test":
        queries = QUICK_QUERIES[:3]
        print(f"AIDO Test Suite - TEST mode ({len(queries)} queries)")
    else:
        queries = TEST_QUERIES
        print(f"AIDO Test Suite - ALL mode ({len(queries)} queries)")

    print("=" * 60)

    results = []

    for i, query in enumerate(queries, 1):
        print(f"[{i}/{len(queries)}] ", end="", flush=True)

        result = run_query(query)
        results.append(result)

        status = "✓" if result["success"] else "✗"
        model_short = result["model"][:15] if result["model"] else "?"
        print(f"{status} {result['elapsed']:5.1f}s | {model_short}")

        if not result["success"]:
            print(f"   Error: {result['error']}")

    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)

    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    print(f"Total: {len(results)}")
    print(f"Successful: {len(successful)} ({len(successful) * 100 // len(results)}%)")
    print(f"Failed: {len(failed)}")

    # Model usage
    model_counts = {}
    for r in successful:
        m = r.get("model", "unknown")
        model_counts[m] = model_counts.get(m, 0) + 1

    if model_counts:
        print(f"\nModel usage:")
        for model, count in sorted(model_counts.items(), key=lambda x: -x[1]):
            print(f"  {model}: {count}")

    if successful:
        avg_time = sum(r["elapsed"] for r in successful) / len(successful)
        min_time = min(r["elapsed"] for r in successful)
        max_time = max(r["elapsed"] for r in successful)

        print(f"\nTiming:")
        print(f"  Average: {avg_time:.1f}s")
        print(f"  Min: {min_time:.1f}s")
        print(f"  Max: {max_time:.1f}s")

    if failed:
        print(f"\nFailed queries:")
        for r in failed:
            print(f"  - {r['query'][:50]}... ({r['error']})")

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = f"/tmp/aido_test_results_{timestamp}.json"

    with open(output_file, "w") as f:
        json.dump(
            {
                "timestamp": timestamp,
                "total": len(results),
                "successful": len(successful),
                "failed": len(failed),
                "model_usage": model_counts,
                "results": results,
            },
            f,
            indent=2,
        )

    print(f"\nResults saved to: {output_file}")

    return 0 if len(failed) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

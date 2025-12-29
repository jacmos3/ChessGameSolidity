import React, { Component } from 'react';
import styles from "../../styles/components/Menu.module.scss";
import { menuDetails } from "../../public/lists/menuDetails.js";

class Menu extends Component {
    state = {
        isChecked: false
    };

    handleChange = () => {
        this.setState({ isChecked: !this.state.isChecked });
    };

    render() {
        return (
            <div className={`${styles.nav__section} sticky top-0 z-10`}>
                <div className={styles.title}>Solidity Chess</div>
                <nav className={styles.navMenu}>
                    {menuDetails.map(item => (
                        <a
                            key={item.key}
                            className={styles.a__text}
                            href={item.href}
                            target={item.href.startsWith('http') ? '_blank' : undefined}
                            rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        >
                            {item.value}
                        </a>
                    ))}
                </nav>
                <div className={styles.mobile__menu}>
                    <input
                        type="checkbox"
                        id="toggle-menu"
                        checked={this.state.isChecked}
                        onChange={this.handleChange}
                    />
                    <label htmlFor="toggle-menu">
                        <span></span>
                    </label>
                    <nav>
                        <div>
                            <label htmlFor="toggle-menu">
                                <span></span>
                            </label>
                        </div>
                        <ul>
                            {menuDetails.map(item => (
                                <li key={item.key}>
                                    <a
                                        href={item.href}
                                        onClick={this.handleChange}
                                        target={item.href.startsWith('http') ? '_blank' : undefined}
                                        rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                                    >
                                        {item.value}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
            </div>
        );
    }
}

export default Menu;
